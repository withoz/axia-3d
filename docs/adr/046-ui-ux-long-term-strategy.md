# ADR-046: UI/UX Long-term Strategy + Product Identity Lock

**Status**: **Accepted** (2026-05-02) — LOCKED 정책 #24
**Initiative**: AxiA 의 product identity 고정 — "무엇을 위한 엔진인가"
**Builds on**: 모든 ADR (#7~#45) — 기술 결정의 product anchor
**Audits**:
- `docs/audits/2026-05-02-ui-surface.md` (Phase 1)
- `docs/audits/2026-05-02-integrity-matrix.csv` (Phase 2 Option A)
- `docs/audits/2026-05-02-adr-drift-report.md` (Phase 2 Option C)

## Context

이 ADR 은 **UI/UX 결정서로 보이지만 본질은 product strategy lock**.

CLAUDE.md 의 한 줄:
> 블렌더보다 쉽고, 스케치업보다 정확한 3D 모델링 플랫폼.
> CAD 를 대치하는 가벼운 동작의 모델링 프로그램.

이 문장이 23 LOCKED 정책 + 82 actions + 4-layer 인프라의 anchor 였으나
**누구를 위한**이 명시되지 않음. 23개 ADR 모두가 "엔진 정확성 / 정합성"
은 enforce 했으나, "사용자 경험 방향성" 은 implicit 했음.

본 ADR 은 **3 vector + 3 persona + 5 pillar + 5 phase 를 명시 lock**
하여 향후 모든 UI / capability / panel 결정의 anchor 를 제공.

### 직접 동기

Phase 1+2 audits 결과:
- 121 menu leaves, 51 actions single-surface (discoverability gap)
- 16 panels, 1 dead-code (MaterialPropertiesPanel removed by ADR-045 PR-1)
- 90% integrity, 78% LOCKED 정책 ENFORCED
- 4 vocabulary naming drift (now SSOT 통합 by ADR-045 PR-2)

엔진/MCP/scaffold/release 인프라는 stable. **이제 사용자 경험 방향
lock 시점**.

## Decision

### P31 — Product Identity + UI/UX Long-term Strategy

> **AxiA 는 P1 (건축/디자인) primary + P3 (AI 협업자) strong secondary
> 를 위한 가벼운 정확한 CAD 다. 모든 UI 결정은 ActionCatalog SSOT 를
> 통과하며, AI 호출과 사람 클릭이 동일 surface 에서 동작한다. 이 정체성은
> 향후 모든 ADR 의 anchor 가 된다.**

### P31.1 — 7 Open Questions 합의 (lock)

| # | 질문 | **결정** | 근거 |
|---|---|---|---|
| Q1 | 주 사용자 페르소나 | **P1 primary + P3 strong secondary** | P1 시장 entry (SketchUp 난민), P3 first-mover 차별화 |
| Q2 | Sketch vs Direct-3D | **둘 다 first-class, mode 로 분리** | 엔진 구조 (ADR-019 sketch + 3D primitives) 자연 정합 |
| Q3 | AI 통합 강도 | **(a) Optional sidebar, default off** | P1/P2 부담 0, P3 강력 surface |
| Q4 | Mode switching | **(c) 사용자 토글, default off** | additive 변경, 학습 곡선 점진 |
| Q5 | 메뉴 재구성 | **A → B 점진** (Mode-aware filter) | muscle memory 보호 필수 |
| Q6 | 모바일 지원 | **(a) 데스크톱 only** | Three.js + viewport 구조상, 별도 ADR |
| Q7 | 다국어 | **(b) 한국어 + 영어** (Phase 2 부터) | infra 만 도입, 번역 community |

### P31.2 — 3 Vector (engine 목표 정량화)

| Vector | 측정 가능한 의미 | 현재 상태 |
|---|---|---|
| **Easier than Blender** | "Modeling 메뉴 진입 → 첫 결과까지 click ≤ 3" | 평균 4 (good, 추가 개선 가능) |
| **More precise than SketchUp** | "수치 입력 / OSNAP / cardinal snap 기본값" | ✅ ADR-026/038 lock |
| **Lighter than CAD** | "초기 번들 ≤ 500KB, 첫 grid 표시 ≤ 1.5s" | 252KB ✅ (50% margin) |

### P31.3 — 3 User Personas (lock)

#### P1 — 건축/디자인 (primary)
- **출신**: SketchUp / Rhino 난민
- **원하는 것**: 스케치 → 익스트루드, 작은 모델 빠르게, 정확한 토폴로지
- **워크플로우**: 2D-first sketch mode → 3D 변환
- **우리 강점**: ADR-021/025 (정확한 면 합성), ADR-028~030 (NURBS), ADR-018 (clean render)

#### P2 — CAD 전문가 (deprioritized)
- **출신**: AutoCAD / Fusion 360
- **상태**: AutoCAD 30년 muscle memory + Fusion 무료 entry 와 경쟁 불리
- **결정**: 적극 진입 안 함. CommandInput 등 기존 facility 는 유지하되 P2-우선 기능 신규 개발 안 함.

#### P3 — AI 협업자 (strong secondary)
- **출신**: Claude Desktop / Cursor / Anthropic Managed Agents 사용자
- **원하는 것**: 자연어 prompt → AI가 모델 일부 생성/수정 → 사람 검수/편집
- **우리 강점**: MCP server (ADR-041~044), ActionCatalog SSOT (ADR-045 D1)
- **시장 위치**: **first-mover** — Blender / SketchUp / Fusion 모두 MCP-first 가 아님

### P31.4 — 5 Pillar UI/UX Strategy

#### Pillar 1 — Discoverability (가장 시급)
- **문제**: 51 actions single-surface (Phase 1 audit)
- **해결**: ADR-045 D3 Capability Explorer + Cmd-K palette
- **회귀**: `explorer_renders_all_tier0_capabilities` (ADR-045 D3)

#### Pillar 2 — Precision Visibility
- 항상-on coordinate readout (StatusBar 이미 ✅)
- OSNAP marker prominence
- VCB (수치 입력) 자동 focus during draw — 이미 ✅
- Cardinal-snap 시각 피드백 ("X-axis lock" 표시) — Phase 2 추가
- Dimension 자동 표시 토글 발견성 개선

#### Pillar 3 — Mode Coherence
**4-mode workspace** (Q4 합의 — 사용자 토글, default off):
```
[Sketch] [Model] [Inspect] [Debug]
```
| 모드 | 노출 도구 | 노출 패널 |
|---|---|---|
| Sketch | 2D draw + constraint | Snap, Constraint |
| Model | 3D primitive + transform + boolean | Style, XIA Inspector |
| Inspect | Read-only | Component, History, Material |
| Debug | All + audit/invariant viz | (Tier 3 unlocked, audit log) |

Mode 도입은 *additive* — 기존 메뉴 영향 0 (Q5 합의).

#### Pillar 4 — AI Seam (MCP-first)
- AI 호출과 사람 클릭이 **ActionCatalog SSOT** 의 동일 surface 통과
- AI 결과가 audit log + viewport visualization 에 동일 노출
- "Ask Claude" context action — Phase 4
- 비활성 시 AI 흔적 0 (Q3 default off)

#### Pillar 5 — Progressive Disclosure
3 surface levels:
- **Beginner**: 8 essentials (line / rect / circle / pushpull / move / undo / save / open)
- **Intermediate**: 현재 메뉴 + Capability Explorer
- **Power**: Command Input + macros + Debug + Tier 3

전환은 사용자 자동 추적 또는 manual settings.

### P31.5 — 5-Phase Roadmap

| Phase | 기간 | 내용 | 대표 PR |
|---|---|---|---|
| **1 — Polish** | 지금 ~ 1개월 | ADR-019/023 회귀, ActionCatalog 활성, Stub 정리 | PR-2.5 |
| **2 — Discoverability** | 1-3개월 | Capability Explorer + Debug Panel + ShortcutHelp auto-gen | PR-3, PR-4 |
| **3 — Mode Workspace** | 3-6개월 | Mode switcher, mode-aware menu filter, onboarding | PR-5 |
| **4 — AI-Collaborative UX** | 6-12개월 | AI sidebar, "Ask Claude" context, 자연어 dispatch | PR-6 ~ |
| **5 — Expert Workflow** | 12개월+ | Custom toolbars, macros, plugin system, cloud sync | PR-X ~ |

### P31.6 — 5 핵심 문장 (ADR 톤)

본 ADR 의 의사결정 anchor:

1. **"AxiA 는 P1 (건축/디자인) primary + P3 (AI 협업자) strong secondary
   를 위한 엔진이다."**
2. **"Discoverability 는 정합성 (ADR-007/021) / 정밀도 (ADR-026/038) 와
   동급의 first-class 원칙이다."**
3. **"AI 호출과 사람 클릭은 ActionCatalog SSOT 를 통과하는 동일 surface
   다 — AxiA 는 AI-collaborative CAD 의 first-mover 다."**
4. **"메뉴 변경은 additive 만 허용 — muscle memory 파괴 변경은 새 ADR
   필요."**
5. **"Mode 는 기존 메뉴를 대체하지 않고 보조한다 — 사용자가 선택할 수
   있는 lens 다."**

### P31.7 — 회귀 invariants (절대 #[ignore] 금지)

| # | invariant | 검증 방법 |
|---|---|---|
| 1 | `persona_p2_no_dedicated_features_after_2026_05` | 새 commit message 가 P2 명시 시 manual review 필요 |
| 2 | `mode_switcher_default_off` | UI 초기 상태 mode = null/single |
| 3 | `ai_sidebar_default_hidden` | 첫 부팅 시 AI sidebar 미표시 |
| 4 | `menu_changes_additive_only` | 메뉴 항목 *제거* 시 새 ADR amendment 필수 |
| 5 | `actioncatalog_ssot_for_ai_and_human` | 모든 capability 호출이 catalog lookup 경유 (ADR-045 D1 회귀로 covered) |
| 6 | `discoverability_no_orphan_actions` | 모든 ActionCatalog entry 가 menu / KB / context / explorer 중 ≥ 1 |

(invariants 1, 4 는 commit/process review — 자동 회귀 어려움. 나머지는
구현 시 회귀 추가.)

## Implementation Roadmap (Phase 별 PR breakdown)

### Phase 1 (지금 ~ 1개월) — 6 PRs

- **PR-2.5** — ToolManager → ActionCatalog 마이그레이션 (~2h, low risk)
- **PR-A** — ADR-019 8 회귀 추가 (~3h)
- **PR-B** — ADR-023 P8 구현 + 회귀 (~2h)
- **PR-C** — ADR-018 색상 회귀 + ADR-024 chamfer 회귀 (~1h)
- **PR-3** — Capability Explorer (~3-4h, ADR-045 D3)
- **PR-4** — Debug Panel (~3h, ADR-045 D5)

이 6 PR 끝나면:
- 23 LOCKED 정책 100% ENFORCED
- ActionCatalog 활성 사용
- Capability Explorer + Debug Panel 동작
- 시스템 정합성 100%

### Phase 2 (1-3개월) — Discoverability 마무리

- ShortcutHelpModal auto-gen from ActionCatalog
- Stub tools 처리 (구현 또는 menu 제거)
- Onboarding tutorial first cut
- i18n infrastructure (영어 번역)

### Phase 3 (3-6개월) — Mode Workspace

- Mode switcher 도입 (Sketch / Model / Inspect / Debug)
- Mode-aware menu filtering
- Beginner / Intermediate / Power 3-level surface

### Phase 4 (6-12개월) — AI-Collaborative UX

- AI sidebar (Claude Desktop 연동)
- "Ask Claude" context action
- 자연어 → action dispatch
- AI 결과 시각화 + edit/approve UI

### Phase 5 (12개월+) — Expert Workflow

- Custom toolbars / shortcuts
- Macro / script
- Plugin system
- Cloud sync (선택)

## Risks & Mitigations

- **R1** — P2 사용자 이탈: P2 deprioritized 결정으로 일부 사용자 잃을 수
  있음. **완화**: 기존 facility (CommandInput, KB shortcuts) 유지.
- **R2** — Mode 도입 학습 곡선: 새 사용자가 mode 를 모르면 더 혼란.
  **완화**: default off + 명시적 onboarding + mode 미사용 시 기존 UX 와
  동일.
- **R3** — AI sidebar 가 P1/P2 부담: default off + opt-in. AI 흔적 0.
- **R4** — Phase 4 (AI sidebar) 12개월 후 시장 변화: MCP 외 다른
  protocol 등장 가능. **완화**: ADR-041 의 capability surface 추상화로
  transport-agnostic — 다른 protocol 추가는 별도 ADR.
- **R5** — Phase 5 plugin system 의 supply-chain risk: 별도 ADR 필요
  (sandboxing, signing, audit).

## Success Criteria

### 단기 (Phase 1, 1개월)
- ✅ ADR-046 P31 결정 commit (이 PR)
- ⏳ Phase 1 6 PRs 완료
- ⏳ 23 LOCKED 정책 100% ENFORCED
- ⏳ Capability Explorer + Debug Panel 동작

### 중기 (Phase 2-3, 6개월)
- ⏳ 새 사용자 onboarding "5 essentials 발견" < 5분
- ⏳ Mode workspace 도입, 사용자 토글 정상 동작
- ⏳ 51 single-surface actions → Capability Explorer 에서 모두 발견 가능
- ⏳ i18n infrastructure (한국어 + 영어)

### 장기 (Phase 4-5, 12개월+)
- ⏳ AI sidebar Beta 활성 사용자 ≥ 100
- ⏳ MCP integration 통한 외부 호출 ≥ 1000건/일
- ⏳ Power user persistence (custom toolbar / macro 사용자) ≥ 50
- ⏳ AxiA 가 "AI-collaborative CAD first-mover" marketing narrative
  검증 (industry 인용 ≥ 3건)

## References

### 직접 영향 ADR (앵커가 되는 결정들)
- **ADR-007**: Face orientation (정확함)
- **ADR-021/025**: 면 합성 (정확함)
- **ADR-026/038**: cardinal SSOT (정밀함)
- **ADR-018**: clean render (시각)
- **ADR-019**: Sketch primitive (워크플로우)
- **ADR-028~030**: NURBS (P1 추가 가치)

### 직접 영향 ADR (UI/UX 직접 결정)
- **ADR-041~044**: MCP / scaffold / release (P3 인프라)
- **ADR-045**: UI consolidation + ActionCatalog (P31 의 implementation 토대)

### 외부 reference
- VS Code Command Palette (Pillar 1)
- Blender F3 search (Pillar 1)
- Fusion 360 search panel (Pillar 1)
- SketchUp Outliner (P1 워크플로우)
- 메타-원칙 #5 (사용자 편의), #11 (latency budget)

## 변경 이력

- **2026-05-02 (initial + accepted)**: P31 + LOCKED #24. 7 Open
  Questions 7/7 모두 합의 후 draft. 5 Pillar + 5 Phase + 5 핵심 문장 +
  6 회귀 invariants (auto 4 + manual review 2). Phase 1 6 PRs 로
  쪼개어 첫 1개월 작업 클리어.
- 본 ADR 은 **product identity** 고정. 향후 모든 UI / capability /
  panel 결정의 anchor. 변경은 amendment ADR + 사용자 명시 동의 필요.

## P31 의 의의 (왜 지금 이 ADR 을 lock 하는가)

> "지금 이 타이밍에 ADR-046 을 lock 하는 건, UI 를 먼저 정하는 게
> 아니라 '무엇을 위해 이 엔진이 존재하는지' 를 고정하는 작업입니다."

23 LOCKED 정책이 모두 "정확함 / 정합성 / 정밀도" 의 enforce. P31 은
처음으로 **사용자 경험 방향성을 명시 lock**. 이후 모든 ADR (ADR-047
이후) 은 P31 의 5 핵심 문장에 정합해야 한다.

향후 의사결정 시 자문할 단 한 가지 질문:

> **"이 변경이 P1 (건축/디자인) primary + P3 (AI 협업자) strong
> secondary 의 가치를 증가시키는가?"**

답이 No 면 즉시 거부. ADR-046 의 anchor 가 noise filter 역할.
