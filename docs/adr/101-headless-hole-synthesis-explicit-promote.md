# ADR-101: Headless Hole Synthesis — Explicit Promote Path Documentation + MCP Surface

- **Status**: H-α Draft (spec only, 2026-05-19)
- **Date**: 2026-05-19
- **Anchor**: Session 2026-05-19 의 hands-on 발견 — headless
  `draw_*_as_shape` 를 두 번 sequential 호출 (rect + 내부 circle, 또는
  큰 circle + 작은 circle) 시 ADR-021 P7 의 component-merge 가 fire
  하지 않아 **2 개의 coplanar overlapping face** 가 잔존. 사용자 의도
  ("구멍 뚫린 면") 와 불일치. `mergeCoplanarContaining` (ADR-006 C1
  Phase F) 명시 호출로 hole loop promote 가 verified 정답 경로.
- **Parent**: ADR-006 (Coplanar merge — anchor), ADR-015 LOCKED #1
  (B1 auto hole-promote 비활성), ADR-021 P7 LOCKED #1 (closed edge
  loop divides face — same-batch only)
- **Sibling**: ADR-041 P26 (MCP capability surface — H-C 확장 base)
- **Related LOCKED**: #1 (ADR-021 P7), #5 (1.5μm dedup), #26 (Two-
  Layer Citizenship Phase 1 ADR-050 P-5c As-Shape Draw single-
  transaction), #34 (ADR-087 kernel-native command suite)
- **Successor**: 없음 (본 ADR 은 documentation + MCP additive surface)

---

## A. Problem Statement

ADR-021 P7 + ADR-015 LOCKED #1 의 component-merge auto hole-promote
는 **single draw batch 내 free-edge resolution** 단계에서만 fire 한다.
이는 의도된 정책 (LOCKED #1 manifold-first) 으로, 사용자 tool 조작
경로 (DrawRectTool 후 DrawCircleTool — 둘 다 drawShapeMode ON, LOCKED
#26 P-5e-α default) 에서는 자연스럽게 작동.

그러나 **headless / scripted / MCP / future automation** 경로에서
`draw_rect_as_shape` 와 `draw_circle_as_shape` 를 두 번 호출하면
각 호출이 **독립 transaction** (ADR-050 P-5c, LOCKED #26 P-5e-γ
replace_last_after_snapshot 1-Undo) 로 단일 face 만 close. 결과:

```
호출 1: draw_rect_as_shape(2000×4000) → face 0 (rect, area 8,000,000)
호출 2: draw_circle_as_shape(r=500)    → face 1 (disk, area 784,137)
                                          face 0 의 area 는 변경 없음
```

두 face 는 *coplanar overlapping* — DCEL invariant 위반은 아니지만
사용자 의도 (ring + hole) 와 불일치. `delete_face(inner)` 호출은 inner
의 boundary edge 를 *free edge 로 잔존* 시켜 시각상 "rect + circle
overlay" 만 만든다. 진짜 hole 아님 (session 2026-05-19 screenshot
근거).

**해결 경로 (verified)**: `mergeCoplanarContaining(outer, inner,
angle_tol_deg)` — ADR-006 C1 Phase F. inner face 를 outer 의 hole
loop 로 흡수. 본 session 에서 직접 검증 (`faceInnerLoopCount(merged)
== 1`, invariants 0 violations).

---

## B. Lock-ins

### H-A — Documentation surface (3-layer 봉인)
1. **CLAUDE.md LOCKED #40 (신규)** — canonical user-facing guidance,
   모든 세션 자동 로드
2. **메타-원칙 #15 신설** — "Headless API ≡ Tool Path 의미 동등".
   일반 원칙 격상, 향후 ADR/PR 의 anchor
3. **`@axia/wasm-node/README.md` 갱신** — headless 사용자 facing
   "Hole synthesis pattern" 섹션 신설

ADR-100 R-α 답습 — spec + LOCKED + README 3-layer 봉인 패턴.

### H-B — Code change: NONE (Q2=a docs only)
**ADR-015 LOCKED #1 / ADR-021 P7 / ADR-049 P-5c 정책 UNCHANGED**.
- Caller 가 `mergeCoplanarContaining` 명시 호출 책임
- `draw_*_as_shape` 의미론 변경 없음 (Q2=c 거부 — 메타-원칙 #10 ADR
  불변 + 회귀 자산 245+ 영향 위험)
- `auto_promote_inner_as_hole` helper API 신설 없음 (Q2=b 거부 — 사용
  사례 부족, 현재 `mergeCoplanarContaining` 충분)

### H-C — MCP capability: `merge_coplanar_containing` Tier 2 추가
ADR-041 P26.1 의 4-tier capability surface 확장. **Tier 2
(modificative, opt-in)** — destructive 까지는 아니나 face topology
재구성. AI agent (P3 페르소나) 가 hole 합성 가능.

구체 schema:
```typescript
{
  capability: 'merge_coplanar_containing',
  tier: 2,
  inputSchema: z.object({
    outer_face_id: OwnerId,
    inner_face_id: OwnerId,
    angle_tol_deg: z.number().min(0).max(45).default(1.0),
  }),
  outputSchema: z.object({
    new_face_id: OwnerId,
    inner_loop_count: z.number(),
  }),
}
```

ADR-041 P26.8 surface drift guard 회귀 자산 갱신 — 33 capabilities
(이전 32). audit_trail (P26.7) Tier 2 success 도 기록.

### H-D — Regression 4-layer (Q4=d 권장)
1. **vitest (a)** — `web/scripts/` 또는 `web/src/test/` 에 headless
   2-shape merge → hole 시나리오. `faceInnerLoopCount === 1` +
   `verifyInvariants.valid === true` 검증
2. **Rust axia-geo (b)** — `mergeCoplanarContaining` 의 ADR-006 C1
   회귀 강화. 기존 회귀 audit 후 누락 케이스 (서로 다른 segment
   count, 비-동심, 비-circle inner shape) 추가
3. **Playwright E2E (c)** — UI tool 경로로 만든 .xia ↔ headless
   스크립트로 만든 .xia 의 **의미 등가** (face/edge/vert count +
   invariants + inner loop count). byte equality 아님 (vert order
   차이 허용)
4. 절대 #[ignore] 금지

### H-E — Memory pointer (Q5=c)
`memory/feedback_headless_hole_synthesis.md` (신규) — short pointer:
"headless `_as_shape` × N → 2 face 잔존. `mergeCoplanarContaining`
명시 호출 필요. 자세한 내용은 LOCKED #40 / ADR-101 참조."

### H-F — Meta-principle #15 신설
**"Headless API ≡ Tool Path 의미 동등"**

> "엔진 API 의 모든 호출 sequence 는 동일 입력의 사용자 tool 조작
> 결과와 *의미 등가* 여야 한다. 차이가 불가피하면 명시적 boundary
> op + 명시 문서화 + 회귀 자산 필수."

- 메타-원칙 #4 (SSOT) + #5 (UX) + #13 (One Source, Two Views) 의
  자연 확장
- ADR-041 P26 (MCP) + LOCKED #34 (kernel-native command suite) 이
  이미 절반 답습 — 본 ADR 으로 anchor 명시
- 적용 사례: 향후 모든 *headless / scripted / MCP* 경로의 결정
  매트릭스에서 첫 질문 = "이 경로가 tool path 와 의미 등가인가?
  아니면 명시 boundary op + 문서화 필요?"

### H-G — Backward compatibility
- ADR-015 LOCKED #1 (B1 auto hole-promote 비활성) 정책 UNCHANGED
- ADR-021 P7 LOCKED #1 (component-merge) fire 조건 UNCHANGED
- 기존 245+ 회귀 자산 0 변경 위험 (Q2=a docs only)
- ADR-076 §C-amendment-1 baseline guard PASS (H-C MCP +1 additive)

---

## C. Acceptance Criteria

| 항목 | 통과 조건 |
|------|----------|
| H-A documentation | LOCKED #40 entry + 메타-원칙 #15 + README 섹션 모두 작성 |
| H-B code change | axia-core / axia-geo / axia-wasm / web/src/ 변경 0 (테스트 추가 외) |
| H-C MCP capability | `merge_coplanar_containing` Tier 2 enrolled, audit 작동, 33 capabilities |
| H-D regression | 4-layer 합산 +5~8 회귀, 절대 #[ignore] 금지 |
| H-E memory | pointer file 작성 |
| H-F meta-principle #15 | CLAUDE.md 메타-원칙 테이블 14 → 15 행 |
| H-G backward compat | 기존 회귀 0 회귀, vite build 정상, vite bundle size delta < 1KB |

---

## D. Acceptance Log

### H-α (본 commit) — spec only

- **commit**: 본 commit (`docs/adr/101-headless-hole-synthesis-explicit-promote.md` 추가)
- **변경**: ADR draft 1 file
- **회귀**: 0 (spec only)
- **Cargo / vitest / Playwright**: 0 sweep (spec only)
- **다음**: H-β (MCP capability `merge_coplanar_containing` Tier 2 등록) —
  packages/axia-mcp-server/src/capabilities/merge_coplanar_containing.ts
  + capability_surface 등록 + Zod schema + handler + dispatcher 분기.
  P26.8 surface drift guard 회귀 갱신.

### H-ζ (본 turn) — CLAUDE.md LOCKED #40 + 메타-원칙 #15 + README

- **변경**: `CLAUDE.md` LOCKED #40 entry 추가 + 메타-원칙 테이블 14 →
  15 + 메타-원칙 #15 detail 섹션 + `packages/axia-wasm-node/README.md`
  `## Hole Synthesis Pattern (ADR-101 / LOCKED #40)` 섹션 신규
- **회귀**: 0 (docs only)
- **Cross-link**: 메타-원칙 #15 "Headless API ≡ Tool Path 의미 동등"
  canonical activation

### H-η (본 turn) — memory pointer

- **변경**: `~/.claude/projects/E--AXiA-3D/memory/
  feedback_headless_hole_synthesis.md` 신규 + `MEMORY.md` index +1
- **회귀**: 0 (memory only)

### H-γ (본 turn) — vitest headless 2-shape → hole regression

- **commit**: 본 turn (`packages/axia-mcp-server/test/
  headless_hole_synthesis.test.ts` 신규)
- **테스트 4개** (절대 #[ignore] 금지 4/4 준수):
  * `headless_two_shapes_overlap_until_explicit_merge` — `_as_shape`
    × 2 후 `faceCount === 2`, 두 face 모두 `faceInnerLoopCount === 0`
    (auto-promote 안 됨 확인 — LOCKED #40 canonical anchor)
  * `merge_coplanar_containing_promotes_to_hole_loop` (rect+circle) —
    `mergeCoplanarContaining` 후 `faceCount === 1`,
    `faceInnerLoopCount(merged) === 1`, `verifyInvariants.valid ===
    true`
  * `merge_coplanar_containing_disk_outer` (big-disk+small-disk) —
    canonical pattern 의 disk-outer variant
  * `merge_coplanar_containing_rejects_non_containing` — swap (small
    outer + big inner) 시 `-1` 반환 + mesh 상태 보존
- **인프라**: `packages/axia-mcp-server/test/` (real WASM 사용 home,
  ADR-041 integration.test.ts 답습 `describe.skipIf(!wasmBuilt)`)
- **Cargo sweep**: vitest @axia/mcp-server 178 → **182 PASS** (+4),
  절대 #[ignore] 금지 4/4 준수.

### H-δ (본 turn) — Rust axia-geo `merge_coplanar_containing` regression strengthen

- **commit**: 본 turn (`crates/axia-geo/src/mesh.rs` 의 `tests`
  module 에 3 회귀 추가)
- **Audit 결과 — 기존 회귀** (mesh.rs:8404~8508):
  * `test_merge_coplanar_containing_creates_hole` (rect+rect basic)
  * `test_merge_coplanar_containing_rejects_sharing_edge`
  * `test_merge_coplanar_containing_rejects_non_coplanar`
  * `test_merge_tolerance_rejects_strict_but_accepts_loose`
- **신규 ADR-101 회귀 3** (절대 #[ignore] 금지 3/3 준수):
  * `test_adr101_merge_coplanar_containing_circle_inner_creates_hole`
    — rect outer + 64-segment circle inner (ADR-101 demo 와 정확히
    동일 크기 2000×4000 + r=500), `inners().len() === 1`
  * `test_adr101_merge_coplanar_containing_rejects_when_inner_outside`
    — H-γ test 4 의 Rust mirror (small outer + big inner swap)
  * `test_adr101_merge_coplanar_containing_rejects_self` —
    `outer == inner` 안전 가드 (mesh.rs:6052 행위 lock-in)
- **Cargo sweep**: axia-geo 1256 → **1259 PASS** (+3), 절대 #[ignore]
  금지 3/3 준수.

### H-β ~ H-ε (remaining)

| Sub | 목표 | 예상 회귀 | 비고 |
|-----|------|----------|------|
| H-β | MCP capability `merge_coplanar_containing` Tier 2 — handler + Zod + surface drift guard | vitest +3 (capability surface) | ADR-041 P26.1 32 → 33 capabilities, P26.8 drift guard 갱신 |
| H-ε | Playwright E2E UI tool 경로 ↔ headless 의미 등가 검증 | Playwright +2 | ADR-075 E.4 인프라 활용 |

**누적 H-α ~ H-η (현재)**: docs +1 ADR + CLAUDE.md (LOCKED #40 +
메타-원칙 #15) + README + memory pointer = docs +4. 회귀: vitest +4
(H-γ) + axia-geo +3 (H-δ) = **+7**, 절대 #[ignore] 금지 7/7 준수.

**남은 회귀 예상 (H-β + H-ε 시)**: +5 → 총 **+12** (모두 절대
#[ignore] 금지 정책 강제).

---

## E. Lessons (filled at H-η closure)

(TBD)

---

## F. Cross-link

- ADR-006 C1 Phase F (`mergeCoplanarContaining` anchor)
- ADR-015 LOCKED #1 (B1 auto hole-promote 비활성 — 본 ADR 의 *왜
  필요한가* 근거)
- ADR-021 P7 LOCKED #1 (component-merge fire 조건 — same-batch only)
- ADR-022 P9 (Vertex-Shared Pinch Auto-Promote — H-A 의 P7 변형 답습)
- ADR-041 P26 (MCP capability surface — H-C base)
- ADR-049 P-5c (Two-Layer Citizenship Phase 1 — Headless 경로 결정
  매트릭스의 첫 발견 시점)
- ADR-050 P-5c (As-Shape Draw single-transaction — 본 lesson 의
  metaphysical 답)
- ADR-076 §C-amendment-1 (baseline guard — H-C MCP +1 additive)
- ADR-100 R-α (5-layer atomic stack 패턴 — H-α ~ H-η 답습)
- LOCKED #26 P-5e-γ (`replace_last_after_snapshot` — Undo 1회 정책,
  본 lesson 의 *왜 두 shape 가 별개 face 인지* 근거)
- LOCKED #34 (ADR-087 kernel-native command suite — 메타-원칙 #15
  의 partial precursor)
- 메타-원칙 #4 (SSOT), #5 (UX), #10 (ADR 불변), #13 (One Source,
  Two Views), #14 (면은 닫힌 경계로부터 유도된다)
