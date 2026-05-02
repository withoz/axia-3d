# ADR-041: AxiA MCP Surface (Capability-Sandboxed)

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #19
**Initiative**: AxiA 3D AI 자동화 도약 (MCP / Claude Desktop / Cursor 통합)
**Builds on**: ADR-014 메타-원칙 #4 (SSOT), #5 (사용자 편의), #11 (Latency
Budget), #13 (One Source, Two Views), ADR-037 (Pick→Promote)

## Context

AxiA 3D 엔진은 현재 **viewport-coupled** 구조: `WasmBridge` 가 Three.js
viewport / Toast / SnapManager 등 UI 레이어와 결합. 사람 사용자만이 1급
client 인 상태.

### AI 시대의 새 client class

Blender / Fusion360 / SketchUp / AutoCAD 비교 분석 (2026-05-02 세션) 결론:
**AI-driven CAD 자동화는 새 client class 이며, MCP (Model Context Protocol)
가 사실상 표준**. Claude Desktop / Cursor / 향후 Anthropic Managed Agents
가 동일 protocol 로 엔진 호출 가능.

### 위험 — naive 노출의 함정

엔진의 **모든 WASM API** 를 그대로 MCP 로 노출하면:
- 🔴 **Capability creep**: AI 가 destructive operation (예: delete_all_xias /
  raw mesh mutation) 호출 가능 → 사용자 데이터 손실
- 🔴 **Schema drift**: 엔진 WASM 버전 ≠ MCP server 버전 → silent corruption
  (예: face_id u32 → u64 마이그레이션 시 잘못된 ID 인용)
- 🔴 **Latency 폭주**: AI agent 가 60Hz 호출 시 stdio JSON-RPC 의 round-trip
  지연 누적 → 사용자 viewport freeze
- 🔴 **State 분리 실패**: viewport user session 과 AI agent session 의 mesh
  state 충돌

산업 사례: GitHub Copilot 의 "filesystem MCP" 가 모든 fs API 노출 → 보안
사고. **whitelist + capability boundary 가 표준**.

## Decision

### P26 — 새 원칙: Capability-Sandboxed MCP Surface

> **MCP 가 노출하는 엔진 API 는 명시적 whitelist (CapabilitySurface) 로만
> 한정한다. 새 capability 추가 = 새 ADR. 모든 호출은 schema_version 검사를
> 거치며 엔진/서버 버전 mismatch 시 즉시 거부.**

ADR-037 P22 (Pick→Promote) 의 의미 ID 원칙을 client boundary 로 확장 —
"AI 도 owner ID 로만 대화한다, raw index 절대 금지".

### P26 세부 규칙 (8 항목)

**P26.1 — Capability Surface 의 4 계층**

```
Tier 0 (read-only, always-on):
  - get_scene_summary, list_xias, list_groups, get_face_info,
    get_edge_info, get_xia_geometry_state
  - schema_version, engine_version

Tier 1 (constructive, default-on):
  - draw_rect, draw_circle, draw_line, draw_polyline
  - create_xia, create_group
  - export_axia, export_obj, export_stl, export_step

Tier 2 (modificative, opt-in via config):
  - push_pull, move_xia, rotate_xia, scale_xia, offset_face
  - boolean_union / subtract / intersect
  - fillet_edge, chamfer_edge

Tier 3 (destructive, explicit user consent each call):
  - erase_face, erase_edge, delete_xia, delete_group
  - import_step (file system access)
```

각 tier 는 `axia.config.json` 의 `mcp.enabled_tiers: [0, 1]` 로 제어. 기본값
**Tier 0 + 1** (read + constructive). Tier 2/3 는 opt-in.

**P26.2 — Schema Versioning 의 3중 방어**

```typescript
// (a) Engine WASM exports
export function schema_version(): string;  // "1.0.0"
export function engine_version(): string;  // "0.1.0+91dc6be"

// (b) MCP server handshake
async function handshake(): Promise<HandshakeResult> {
  const engine_schema = wasm.schema_version();
  const server_schema = MCP_SERVER_SCHEMA_VERSION;  // "1.0.0"
  if (!semver.satisfies(engine_schema, `^${server_schema}`)) {
    throw new SchemaIncompatibleError({
      engine: engine_schema,
      server: server_schema,
      action: "Rebuild axia-wasm or downgrade MCP server"
    });
  }
}

// (c) Per-call schema_version field (optional, future-proof)
// AI 가 자신이 학습한 schema 를 명시 → drift 즉시 감지
```

Semver rule: **MAJOR bump = capability 제거 또는 ID 의미 변경, MINOR =
capability 추가, PATCH = bugfix**.

**P26.3 — Owner ID 만 cross-boundary**

ADR-037 P22 의 자연 연장:
- MCP 입출력의 모든 ID 는 `XiaId | FaceId | EdgeId | VertexId | GroupId` (u32)
- raw triangle index / segment index 절대 노출 금지
- AI 가 "이 face" 를 지칭하려면 항상 `face_id` 사용
- 도구 schema 의 모든 ID 필드는 `{ type: "integer", minimum: 1 }` + 의미
  ID 임을 description 에 명시

**P26.4 — Headless WasmBridge 경로**

`crates/axia-wasm` 에 `--target nodejs` 빌드 추가 → MCP server 는
`@axia/wasm-node` 패키지로 직접 import:

```typescript
import { AxiaEngine } from '@axia/wasm-node';
const engine = new AxiaEngine();  // viewport 없이 동작
engine.draw_rect([0,0,0], [10,10,0]);
const buffers = engine.get_mesh_buffers();
// MCP response: { vertices: [...], faces: [...], xia_ids: [...] }
```

`Viewport`, `Toast`, `SnapManager` 의존성 0. WASM 단독 실행.

**P26.5 — Latency Budget**

ADR-014 메타-원칙 #11 적용:
| Operation | Budget | 측정 |
|---|---|---|
| Tier 0 (read) | < 16 ms | get_scene_summary |
| Tier 1 (draw) | < 33 ms | draw_rect end-to-end |
| Tier 2 (modify) | < 100 ms | push_pull commit |
| Tier 3 (destroy) | < 100 ms | erase + invariant verify |
| Heavy (export STEP) | < 500 ms | 또는 progress streaming |

stdio JSON-RPC overhead ≈ 1~2 ms (Node native). WASM 호출 자체는 마이크로
초 단위 → 위 budget 충분히 여유.

**P26.6 — Session Isolation**

- 사용자 viewport session 과 AI agent session 은 **별개 mesh state**
- MCP server 는 자체 `AxiaEngine` instance 보유 (사용자 viewport 와 독립)
- AI 가 "현재 사용자 화면" 에 영향 주려면 명시적 `apply_to_user_session`
  capability 필요 (Tier 3 로 분류, 향후 ADR-042)
- 본 ADR scope: AI 는 **자신만의 sandbox engine** 에서 작업, 결과는 export
  파일로 사용자에게 전달

**P26.7 — Audit Trail**

모든 Tier 2/3 호출 (성공/실패 무관) **+ 모든 tier 의 denied 호출** 은
JSONL 한 줄로 audit log 에 append. Denied 는 intrusion-detection signal
이라 무조건 기록.

기록 위치 (UTC 일별 rotation):
```
~/.axia/mcp-audit-YYYY-MM-DD.log
```
환경변수 `AXIA_MCP_AUDIT_DIR` 로 디렉토리 override 가능.

각 entry 의 필드:
```jsonc
{
  "timestamp":      "2026-05-02T10:23:45.123Z",  // ISO-8601 UTC
  "request_id":     "1f8b3c4a-...",              // UUID v4 (client correlation)
  "client":         "claude-desktop",
  "tier":           2,                            // 또는 null (unknown capability)
  "capability":     "push_pull",
  "args":           { "face_id": 42, "distance": 50 },
  "duration_ms":    23.4,
  "result":         "ok",                         // "ok" | "error" | "denied"
  "engine_version": "0.1.0",                      // P26.2 drift correlation
  "schema_version": "1.0.0",
  "reason":         "...",                        // denied 사유 (선택)
  "error_message":  "..."                         // engine 실패 사유 (선택)
}
```

**왜 분리했나?**
- `request_id` 가 없으면 동일 capability 다중 호출에서 어느 호출이 어느
  응답이 됐는지 추적 불가. UUID v4 자동 생성, caller 가 override 가능.
- `engine_version` / `schema_version` 매 entry 에 stamp 하면 audit log
  분석 시점에 engine 빌드가 무엇이었는지 영구 보존. handshake 결과만으로
  는 휘발됨.
- `result: 'denied'` 분리 — `error` (engine 내부 실패) 와 `denied`
  (정책 거부) 를 한 필드로 묶으면 보안 분석 시 ambiguous.

**P26.8 — 회귀 테스트** (절대 #[ignore] 금지)

- `mcp_handshake_rejects_schema_mismatch` — major version 불일치 → error
- `mcp_tier3_blocked_when_not_enabled` — config.enabled_tiers=[0,1] →
  erase_face 호출 거부
- `mcp_owner_ids_only_no_raw_indices` — 모든 capability schema 의 ID
  필드는 의미 ID
- `mcp_session_isolation_user_unaffected` — MCP draw → user viewport
  mesh 변화 0
- `mcp_audit_log_records_tier2_calls`
- `mcp_latency_budget_tier1_under_33ms` — 100회 draw_rect 평균
- `mcp_capability_surface_matches_adr_041_p26_1` — whitelist drift 차단

## Implementation 후속 PR scope

### Stage 1 — `axia-wasm` Node target
```toml
# crates/axia-wasm/Cargo.toml
[lib]
crate-type = ["cdylib"]

[features]
default = []
nodejs = []  # wasm-bindgen --target nodejs flag 와 별개로 conditional code
```

```bash
wasm-pack build --target nodejs --out-dir ../../packages/axia-wasm-node
```

신규 export: `schema_version()`, `engine_version()`.

### Stage 2 — `packages/axia-mcp-server` (Node + TS)
```
packages/axia-mcp-server/
  package.json           — @axia/mcp-server, deps: @modelcontextprotocol/sdk
  src/
    index.ts             — entry (stdio transport)
    handshake.ts         — P26.2 schema check
    capabilities/
      tier0_read.ts      — get_scene_summary, list_*
      tier1_draw.ts      — draw_*, create_*
      tier1_export.ts    — export_axia, export_obj, ...
      tier2_modify.ts    — push_pull, boolean_*, ... (opt-in)
      tier3_destroy.ts   — erase_*, delete_* (explicit consent)
    audit.ts             — P26.7
    schema.ts            — Zod schemas (P26.3 owner ID enforcement)
  test/
    handshake.test.ts
    tier_isolation.test.ts
    owner_id_only.test.ts
    latency.test.ts
```

### Stage 3 — 첫 3개 capability end-to-end
1. `draw_rect` (Tier 1) — 가장 단순 토폴로지
2. `push_pull` (Tier 2) — 가장 단순 modificative
3. `export_axia` (Tier 1) — I/O 검증

각각:
- Zod schema 정의 → MCP tool registration → axia-wasm-node 호출 →
  result 직렬화 → audit log
- vitest e2e (mock MCP client → real wasm)

### Stage 4 — Claude Desktop / Cursor 설정 가이드
`docs/integrations/mcp-claude-desktop.md`:
```json
{
  "mcpServers": {
    "axia": {
      "command": "node",
      "args": ["/path/to/packages/axia-mcp-server/dist/index.js"],
      "env": {
        "AXIA_MCP_TIERS": "0,1"
      }
    }
  }
}
```

`docs/integrations/mcp-cursor.md`: Cursor 의 MCP config 동일 형식.

## Risks & Mitigations

- **R1** — Capability creep: 새 capability 가 ad-hoc 추가됨
  → 새 capability = 새 ADR (P26.1 의 4-tier 명시 필수)
- **R2** — Schema drift silent corruption: P26.2 의 3중 방어 (engine /
  server / per-call) + 회귀 테스트
- **R3** — User viewport 충돌: P26.6 session isolation, Tier 3 분리
- **R4** — AI hallucination 으로 destructive 호출: Tier 3 default off + audit
- **R5** — 성능 회귀: P26.5 budget 회귀 테스트로 차단
- **R6** — 시장 표준 변동 (MCP → 다른 protocol): CapabilitySurface 추상화
  로 transport-agnostic. stdio 외 SSE / WebSocket adapter 추가 가능.

## Success Criteria

- ✅ ADR-041 P26 결정이 commit 으로 고정
- ✅ **Stage 1 완료**: axia-wasm-node 빌드 + schema_version / engine_version
  WASM exports (commit 28be6ff)
- ✅ **Stage 2 완료**: @axia/mcp-server scaffolding + handshake +
  tier-authorize + audit + Zod schemas (commit d9deb6d)
- ✅ **Stage 3 완료**: draw_rect / push_pull / export_axia e2e —
  실제 axia-wasm-node 호출까지 검증 (commit 8bf0a44)
  - Tier 1 draw_rect e2e median latency: **8 ms** (P26.5 budget 33ms 의 24%)
  - 64 / 64 tests passing
  - node dist/index.js 부팅: "Handshake OK — engine schema=1.0.0"
- ✅ **Stage 4 완료**: Claude Desktop / Cursor 통합 가이드 +
  docs/integrations/ 문서화 (이 commit)
- ✅ **7 / 7 회귀 테스트 통과** (P26.8):
  - mcp_handshake_rejects_schema_mismatch
  - mcp_tier3_blocked_when_not_enabled
  - mcp_owner_ids_only_no_raw_indices
  - mcp_session_isolation_user_unaffected
  - mcp_audit_log_records_tier2_calls
  - mcp_latency_budget_tier1_under_33ms
  - mcp_capability_surface_matches_adr_041_p26_1
- ✅ Tier 2/3 audit log 검증 (MemoryAuditSink + e2e push_pull 항상
  audit 기록 — 성공 / 실패 무관)

## References

- ADR-014 메타-원칙 #4 (SSOT), #11 (Latency Budget), #13 (One Source, Two Views)
- ADR-037 P22 (Pick → Promote — owner ID 원칙)
- Model Context Protocol spec (https://modelcontextprotocol.io)
- Anthropic SDK MCP integration patterns
- 산업 사례: GitHub Copilot filesystem MCP capability boundary 사고

## 변경 이력

- **2026-05-02 (initial draft)**: P26 신규. 8 세부 규칙 (4-tier capability /
  3중 schema versioning / owner-ID only / headless / latency / session
  isolation / audit / 7 회귀 테스트). Migration 4-stage 분할 (Node WASM →
  MCP server scaffold → 첫 3 capability → integration guide).
- **2026-05-02 (accepted)**: Stage 1~4 4-PR 모두 완료. 회귀 테스트 7/7
  통과, e2e latency 8ms median (budget 24%). Status: **Proposed →
  Accepted**, LOCKED 정책 #19 으로 격상. CLAUDE.md 갱신.
- **2026-05-02 (post-acceptance follow-up)**: Audit trail 보강 (P26.7
  강화) + CI 자동화 + 사용자 onboarding 안전장치:
  - **Audit boost** (B): `request_id` (UUID v4), `engine_version` /
    `schema_version` per-entry, `denied` result 분리, daily rotation
    (`mcp-audit-YYYY-MM-DD.log`), `AXIA_MCP_AUDIT_DIR` env override.
    Denied 는 모든 tier 에서 무조건 기록 (intrusion signal).
  - **Onboarding guard** (C): `packages/axia-mcp-server` 의 `postinstall`
    훅 (`scripts/check-wasm.mjs`) — WASM artifact 누락 시 친절한 stderr
    경고 + exit 0 (npm install fail-soft). Rust 미설치 환경에서도 install
    안 깨짐.
  - **CI** (A): `.github/workflows/mcp.yml` 신설. 3-job pipeline:
    wasm-node-build → mcp-server-test (Node 20/22 matrix) →
    surface-drift-guard (P26.8 7 회귀 isolated 실행). Server boot
    smoke test 포함.
  - 80 tests passing (+13 from boost). 모든 dispatch 호출에 `versions`
    필수 — 회귀 방어선 강화.
