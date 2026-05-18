# ADR-131 — Cmd-K Palette Already Exists Pivot (ADR-130 γ-1 Audit Closure)

| Field | Value |
|---|---|
| Status | **Accepted (2026-05-17)** — audit closure + γ-1 pivot decision, docs only single PR per LOCKED #44 |
| Date | 2026-05-17 |
| Author | AXiA team (사용자 결재 2026-05-17 — "승인합니다" Option A 채택) |
| Anchor | Pre-implementation audit (2026-05-17) of γ-1 (Cmd-K entry + empty modal) β implementation 진입 시점 — **CommandPalette.ts (286 LOC) + CommandCatalog.ts (159 LOC) + AxiaCommands.ts (273 LOC, 148 commands registered) 이미 production 활성 발견**. ADR-130 audit 의 architectural blindspot 노출 |
| Parent | ADR-130 (Pillar 1 audit ADR — Amendment 1 추가 대상), ADR-046 P31 Pillar 1 (Discoverability anchor) |
| Cross-cut | ADR-045 D1 (ActionCatalog SSOT — *parallel* system to CommandCatalog), ADR-125 pivot pattern (audit closure ADR canonical 1번째 source), ADR-126/127 (pivot pattern 2/3번째 답습), ADR-046 P31 #4 additive only |

---

## 1. Canonical Anchor

ADR-130 audit 결재 후 γ-1 (Cmd-K entry + empty modal) β implementation 진입 시점 (2026-05-17, 첫 implementation step 직전 `Write` tool fail 발생):

```
Error: File has not been read yet. Read it first before writing to it.
```

→ Read tool 확인: `web/src/ui/CommandPalette.ts` (286 LOC) **이미 완성된 production-ready Cmd-K palette 발견**.

사용자 결재:
> "승인합니다" (2026-05-17, Option A — ADR-131 pivot to audit closure)

본 ADR 은 **세션 audit-first canonical 6번째 적용** (ADR-125 α-1 / ADR-126 α-2 / ADR-127 α-4 / ADR-128 priority #4 / ADR-130 Pillar 1 답습). 본 케이스는 *audit ADR ITSELF가 audit miss* 한 메타-finding — pattern의 self-applying 강건성 evidence.

---

## 2. Audit Findings (canonical evidence)

### 2.1 Existing implementation inventory (실측 file:line)

| File | LOC | Status | Evidence |
|---|---|---|---|
| `web/src/ui/CommandPalette.ts` | **286** | ✅ Full Cmd-K palette | Class `CommandPalette` (line 78), `show()`/`hide()`/`toggle()` (89-106), fuzzy search `score_match` (229-245), `↑/↓` nav (165-176), Enter run (160-164), Esc close (159), overlay click close (152-155) |
| `web/src/commands/CommandCatalog.ts` | 159 | ✅ Full registry | `CommandCatalog` class (line 70), `register`/`has`/`get`/`list`/`toolbarGroups` API, singleton `getCommandCatalog()` |
| `web/src/commands/AxiaCommands.ts` | 273 | ✅ **148 commands registered** (verified `grep -c "cmds.push"`) | `registerAxiaCommands()` (line 81), tools (Select/Line/Rect/Circle/Push/Pull/primitives 등 35+), actions (mirror/revolve/subdivide/thicken/solidify/fillet 등 113+) |
| `web/src/ui/CommandPalette.test.ts` | exists | ✅ Tests | `describe('CommandPalette')` regression |
| `web/src/commands/CommandCatalog.test.ts` | exists | ✅ Tests | `getCommandCatalog`/`__resetCommandCatalog` |
| `web/src/commands/AxiaCommands.test.ts` | exists | ✅ Tests | Catalog registration regression |

### 2.2 Production wiring (실측)

`web/src/main.ts:458-465`:

```typescript
void import('./commands/AxiaCommands').then(({ registerAxiaCommands }) => {
  registerAxiaCommands({ toolManager });
});
// Command Palette — Ctrl+K / Ctrl+Shift+P opens a searchable list...
void import('./ui/CommandPalette').then(({ bindCommandPaletteHotkey }) => {
  bindCommandPaletteHotkey();
});
```

**Cmd-K / Ctrl+K / Ctrl+Shift+P production 활성 중** (line 273-285 of CommandPalette.ts):

```typescript
export function bindCommandPaletteHotkey(): () => void {
  const handler = (e: KeyboardEvent) => {
    const isOpen = (e.ctrlKey || e.metaKey) && (
      (e.key === 'k' || e.key === 'K') ||
      (e.shiftKey && (e.key === 'p' || e.key === 'P'))
    );
    if (isOpen) {
      e.preventDefault();
      getCommandPalette().toggle();
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
```

### 2.3 Dual catalog system architectural finding (canonical)

**Two parallel catalog systems exist** (이전 ADR 들에서 *별개* 로 진화):

| System | Location | Used by | Action count | Status |
|---|---|---|---|---|
| **ActionCatalog** (ADR-045 D1) | `packages/axia-action-catalog/` (workspace package) | CapabilityExplorerPanel ONLY | 95 actions | Isolated — D1 SSOT policy locked |
| **CommandCatalog** (production) | `web/src/commands/CommandCatalog.ts` | CommandPalette + main.ts wiring | **148 commands** (verified) | **Production active** — actual SSOT for Cmd-K |

**Architectural finding**: ADR-130 §2.3 audit가 ActionCatalog import 만 검색 (`packages/axia-action-catalog/` imports) — CommandCatalog는 별개 system이라 누락. **ADR-045 D1 SSOT policy + ADR-130 §2.3 binding gap 가정 둘 다 invalid** (production 의 SSOT는 CommandCatalog).

### 2.4 ADR-130 audit miss 메타-분석

| ADR-130 §2.3 가정 | 실측 audit |
|---|---|
| "CapabilityExplorerPanel = ONLY ActionCatalog consumer" | ✅ 정확 (regression test로 보장) |
| "MenuBar / KeyboardShortcuts / ShortcutHelp 모두 hardcoded" | ⚠ MenuBar/KeyboardShortcuts는 *CommandCatalog 통해* 자동 binding 가능 (확인 필요) |
| "Cmd-K NOT implemented" | ❌ **무효 — CommandPalette 이미 production 활성** |
| "Fuzzy search library 미선택" | ⚠ CommandPalette는 자체 fuzzy `score_match` + `containsAll` 사용 — fuzzysort/fuse.js 외부 lib 필요 없음 |
| "Phase 2 prerequisites — fuzzy lib selection" | ❌ 무효 — 이미 production fuzzy 활성 |

**ADR-130 §2.3 의 4 finding 중 1 정확, 1 부분 정확, 2 무효** — audit ADR ITSELF의 architectural blindspot.

### 2.5 진짜 Pillar 1 gap (재발견)

ADR-130 audit miss correction 후 진짜 gap:

1. **Dual catalog system 통합 미정** — ActionCatalog (ADR-045 D1) ↔ CommandCatalog (production) 의 architectural 관계 미정의. ActionCatalog는 isolated (CapabilityExplorer 만), CommandCatalog는 production SSOT — 두 시스템 중복 데이터 + drift risk.
2. **CapabilityExplorerPanel vs CommandPalette UX 중복** — 둘 다 action listing + search + invoke 기능. 사용자 facing 으로 *두 different palette* 가 존재 (F1 ShortcutHelp + Cmd-K CommandPalette + CapabilityExplorerPanel).
3. **i18n infrastructure** — ADR-130 §2.5 확인 정합 (여전히 미정의, Phase 2 explicit gate)
4. **ActionCatalog Tier 3 destructive content** — ADR-045 D3 reserved (production 0)

이 4 gap이 Pillar 1 의 *진짜* architectural debt — 별도 ADR-132 (가칭) 후속 가능.

---

## 3. Pivot Decision (canonical lock-in)

### 3.1 Pivot summary

ADR-130 γ-1 (Cmd-K entry + empty modal) β implementation **거부**. 사유:
- CommandPalette + CommandCatalog 이미 production 활성 (148 commands)
- 새 CommandPalette 별도 파일 생성 시 duplicate system (architectural debt 증가)
- ADR-130 §3.2 hotspot 가정 무효 (Pillar 1 의 실제 gap = 다른 영역)

**대안 채택**:
- ADR-130 §spec 보존 + Amendment 1 추가 (current state correction + γ-1 무효 명시)
- 진짜 Pillar 1 gap (§2.5 의 4 영역) 재정의
- 새 priority 후속 결재 — ADR-132 (가칭, dual catalog unification audit) 또는 다른 path

### 3.2 거부 근거 (lock-in)

- **L-131-D1** Duplicate system 거부 — 동일 파일명 `CommandPalette.ts` overwrite or 별도 파일 add 모두 architectural debt
- **L-131-D2** Production wiring 보존 — `main.ts:463-464` `bindCommandPaletteHotkey()` 정상 동작 유지
- **L-131-D3** ADR-046 P31 #4 additive only — 새 Cmd-K 추가 = production functionality 무효화 (additive 위반)
- **L-131-D4** ADR-130 audit ADR ITSELF의 architectural blindspot — *audit 자체에 audit-first canonical 적용해야* 함 (메타-finding lock-in)
- **L-131-D5** 진짜 Pillar 1 gap (§2.5) 재정의 → ADR-130 Amendment 1 + 새 priority audit ADR-132 (가칭) 자연 trigger

### 3.3 ADR-130 Pillar 1 priority status

ADR-129 Priority #1 (Pillar 1 Discoverability) **부분 closure 도달** — Cmd-K palette 이미 production 활성. 진짜 Pillar 1 closure 의 잔존 gap = §2.5 의 4 영역 (별도 priority audit ADR-132 가칭).

---

## 4. Lock-ins (canonical, L-131-1 ~ L-131-10)

- **L-131-1** Pre-implementation audit canonical **6번째 적용** — implementation 시작 직전 architectural reality 재확인 (Write tool fail이 trigger evidence)
- **L-131-2** Existing implementation preservation — `web/src/ui/CommandPalette.ts` + `web/src/commands/CommandCatalog.ts` + `web/src/commands/AxiaCommands.ts` 전부 보존 (NOT superseded)
- **L-131-3** Dual catalog finding architectural lock-in — ActionCatalog (ADR-045 D1) ↔ CommandCatalog (production) 의 *별개* 시스템 관계 명시 lock-in
- **L-131-4** ADR-130 audit miss 메타-finding lock-in — audit ADR ITSELF의 architectural blindspot 명시 (audit-first canonical pattern의 self-applying 강건성 evidence)
- **L-131-5** ADR-130 §spec 보존 + Amendment 1 추가 (ADR-125 §A1.3 / ADR-126 Amendment 2 / ADR-127 Amendment 3 답습 — spec preservation pattern 5번째 적용)
- **L-131-6** 부정 결정 명시 lock-in (ADR-076 §C-amendment-1 / ADR-125 L-125-6 / ADR-127 L-127-7 답습 — 4번째 적용)
- **L-131-7** ADR-046 P31 #4 additive only 정합 — production functionality 무효화 거부
- **L-131-8** 진짜 Pillar 1 gap (§2.5 4 영역) 별도 ADR-132 (가칭) audit ADR trigger anchor
- **L-131-9** AxiA Architecture audit 패턴 개선 — 향후 audit ADR은 **production wiring 직접 검증** 필수 (main.ts imports + dynamic imports + bindHotkey calls)
- **L-131-10** 절대 #[ignore] 금지

---

## 5. 회귀 (0)

본 ADR은 docs only. 회귀 없음.

- `cargo test`: UNCHANGED
- `vitest run`: UNCHANGED (1917 maintained per LOCKED #58)
- Playwright E2E: UNCHANGED
- ADR-077 V-2 visual baselines: UNCHANGED
- **Production CommandPalette functionality**: UNCHANGED (보존)

---

## 6. Out of Scope (별도 ADR per LOCKED #44)

- **ADR-132 (가칭) — Dual catalog unification audit** (§2.3 architectural finding) — ActionCatalog ↔ CommandCatalog 통합 결재 ADR. 95 + 148 entries duplicate analysis + unification path matrix
- **CapabilityExplorerPanel vs CommandPalette UX 중복 해소** — §2.5 #2 영역, dual catalog unification 후속
- **i18n infrastructure** (ADR-046 Q7 Korean+English) — Phase 2 explicit gate, ADR-130 §2.5 정합
- **ActionCatalog Tier 3 destructive content** — ADR-045 D3 reserved
- **CommandCatalog vs ActionCatalog migration** (1방향 deprecation 또는 양방향 sync) — dual catalog unification audit 후속

---

## 7. Cross-link

- **ADR-130** — γ-1 source ADR (Amendment 1 추가 대상, current state correction)
- **ADR-129** — priority track spec (Pillar 1 = Priority #1, 부분 closure 명시 update 필요 시 별도 amendment)
- **ADR-045 D1** — ActionCatalog SSOT spec (95 actions, isolated system)
- **ADR-046 P31 Pillar 1** — Discoverability anchor (production 이미 활성, 진짜 gap 재정의)
- **ADR-125** — audit closure pattern source (1번째 — Selection BBox already optimized)
- **ADR-126** — audit pivot + β impl pattern (2번째 — InstancedMesh wrong API)
- **ADR-127** — audit closure pattern (3번째 — Helper lines Canvas 2D dominant)
- **ADR-128** — priority track β implementation (4번째 audit-first canonical)
- **ADR-076 §C-amendment-1** — 부정 결정 명시 lock-in 패턴 source (4번째 답습)
- **ADR-077 V-2** — visual baseline 보존 (UNCHANGED)
- **ADR-046 P31 #4** — additive only (L-131-7)
- **LOCKED #43** — 직전 priority track (100% closure)
- **LOCKED #44** — Complete Meaning per Merge (docs-only PR scope)
- **LOCKED #58** — 직전 closure (ADR-128 priority #4 + Q1=G)
- **LOCKED #59** (본 PR) — ADR-131 audit closure + ADR-130 Amendment 1 + dual catalog finding

---

## D. Acceptance Log

| Sub-step | Status | 산출물 |
|---|---|---|
| 첫 implementation step (Write CommandPalette.ts) → `File has not been read` error | ✅ trigger | Implementation halt + Read existing file |
| Read existing `CommandPalette.ts` (286 LOC) | ✅ | Full production-ready Cmd-K palette confirmed |
| Grep production wiring (main.ts:458-465 + bindCommandPaletteHotkey) | ✅ | Production active 확인 |
| Verify CommandCatalog + AxiaCommands (148 commands) | ✅ | Production catalog with 148 entries |
| Dual catalog architectural finding 식별 | ✅ | ActionCatalog ↔ CommandCatalog 별개 system |
| Escalate to user (Option A/B/C/D/E matrix) | ✅ | 사용자 결재 Option A |
| Pivot decision lock-in (§3) | ✅ | γ-1 거부 + ADR-130 Amendment 1 추가 |
| ADR-130 Amendment 1 추가 | ✅ | `docs/adr/130-*.md` Amendment 1 section |
| CLAUDE.md LOCKED #59 entry | ✅ | LOCKED #59 |

---

## E. Lessons (canonical for future audit-first / audit ADR self-application)

- **L-131-α-1 — Audit ADR ITSELF가 audit-first canonical 적용 필요 (메타-finding)**: ADR-130 audit가 ActionCatalog import만 검색 → 별개 system (CommandCatalog) 누락. 향후 모든 audit ADR은 *audit ADR 자체* 도 architectural reality 재확인 필요. Specifically:
  - **production wiring 직접 검증 강제** (main.ts dynamic imports, hotkey bindings, runtime wiring)
  - **Multiple systems search** (단일 keyword 기준 검색 거부 — `Catalog` 외 `Palette`/`Registry`/`Manager` 등 cross-검색)
  - **Implementation 시작 전 read-tool check** — Write tool fail = pre-existing implementation signal (본 케이스의 trigger)
- **L-131-α-2 — Dual system architectural pattern 명시**: 5개월 누적 AxiA에 *parallel evolution* 시스템 다수 존재 가능성 — ActionCatalog (ADR-045) vs CommandCatalog (production). 향후 audit는 *parallel system existence* 가정 → cross-search 강제.
- **L-131-α-3 — `File has not been read` error의 architectural value**: Write tool fail은 pre-existing implementation의 silent signal. 향후 ADR 진행 시 *file existence check* 를 audit step에 명시 포함.
- **L-131-α-4 — Spec preservation pattern 5번째 적용**: ADR-122 Amendment 1/2/3 + ADR-120 Amendment 1 + **ADR-130 Amendment 1 (본 ADR)** = 5번째 적용. supersede 회피 + current state correction 패턴 정착.
- **L-131-α-5 — 부정 결정 4번째 lock-in**: ADR-076 / ADR-125 / ADR-127 답습. 향후 누군가 ADR-130 γ-1 새 implementation 시도 시 본 ADR-131 즉시 발견 가능.
- **L-131-α-6 — Audit-first canonical의 self-applying robustness**: ADR-130 audit ADR 자체에서 finding miss → 본 ADR-131 가 finding 발견 → 패턴이 self-recursively 동작. ADR-125 L-125-1 (audit-first canonical) 의 deepest realization.
- **L-131-α-7 — Pillar 1 priority status redefinition**: ADR-129 Priority #1 의 진짜 gap = §2.5 의 4 영역 (dual catalog unification / UX 중복 / i18n / Tier 3) — 별도 ADR-132 (가칭) audit ADR trigger anchor.
