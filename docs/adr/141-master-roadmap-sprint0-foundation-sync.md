# ADR-141 — Master Roadmap (Sprint 0~6+4.5, ADR-141~161 reserve, 5/7개월 production RC)

**Status**: Accepted (Sprint 0 Foundation Sync closure)
**Date**: 2026-05-22
**Author**: WYKO + Claude
**Trigger**: 사용자 결재 (2026-05-22) — 외부 에이전트 마스터 완성 계획 (`reports/최종_결재완료_Sprint0_시작.html` + `reports/Sprint0_Kickoff_Guide.html` + `reports/마스터_완성계획.html` + `reports/곡선면_도형그리기_완성계획.html`) 5/5 결재 + 본 세션 audit-first 16번째 정정 (ADR 번호 재배정 ADR-101~123 → ADR-141~161).

## Canonical anchor (사용자 결재, 2026-05-22)

> "5/5 결재 lock-in (옵션 B 면 생성 / 옵션 A Ellipse / 신규 3 ADR / Sprint +1주 / 21~29주 +330 회귀). Sprint 0 Foundation Sync 즉시 시작. ADR 번호 ADR-141~161 재배정 적용. 5/5 결재 의도 모두 보존."

본 ADR 은 **production-grade RC** 까지의 21~29주 (5~7개월) 통합
roadmap. 외부 agent 작성 계획 (보고서 4 파일) 의 *의도* 를 보존하면서
ADR 번호 영역만 main 현실 (ADR-100~140 all used) 에 정합 재배정.
LOCKED #44 "Complete Meaning per Merge" + 메타-원칙 #16 "자동화는
사용자 의도를 미리 알 수 없다" 정합.

## 1. 5/5 결재 lock-in (canonical, 2026-05-22)

### 결재 1 — 면 생성 정책 옵션 B (annulus 명시 활성)

> Circle 두 번 그릴 때 두 별개 face 유지. 사용자가 우클릭
> "annulus 만들기" 명시 trigger 시 promote.

**메타-원칙 #16 정합**: 휴리스틱 자동 annulus promote (어느 Circle 이
hole 이고 어느 Circle 이 outer 인지 추측) → 폐기. 사용자 명시 의도
→ canonical.

**ADR-145 (재배정)** — Circle annulus ContextMenu "annulus 만들기" 우클릭 액션.

### 결재 2 — Ellipse 옵션 A (NURBS-only)

> DrawEllipseTool 신설, 내부적으로 9-CP NURBS (Piegl A7.1) 생성.
> AnalyticCurve enum 불변.

**ADR-027 NURBS Kernel 정합**: AnalyticCurve enum 에 Ellipse variant
신설 회피 — NURBS rational representation (Piegl A7.1 standard) 으로
exact unit circle / ellipse 표현 가능. enum churn 0.

**ADR-158 (재배정)** — DrawEllipseTool + 9-CP NURBS.

### 결재 3 — 신규 ADR 3개 추가

| 외부 agent 원안 | 재배정 | 제목 |
|---|---|---|
| ADR-121 | **ADR-145** | Circle annulus 명시 활성 (옵션 B) |
| ADR-122 | **ADR-158** | DrawEllipseTool (옵션 A NURBS-only) |
| ADR-123 | **ADR-159** | Surface-aware Push/Pull |

### 결재 4 — Sprint 1 / Sprint 5 각 +1주 확장

| Sprint | 원안 | 확정 | 사유 |
|---|---|---|---|
| Sprint 1 | 2~3주 | **3~4주** | +1주 (Circle annulus ADR-145 추가) |
| Sprint 5 | 2~3주 | **3~4주** | +1주 (Ellipse + Surface Push/Pull 추가) |

### 결재 5 — 총 timeline 21~29주 / 회귀 +330

| 항목 | 원안 | 확정 |
|---|---|---|
| Total timeline | 18~25주 | **21~29주 (5~7개월)** |
| 누적 회귀 | +285 | **+330** (절대 #[ignore] 금지 330/330 강제) |

## 2. 8-Sprint 통합 roadmap

| Sprint | 제목 | 기간 | 누적 | 회귀 | ADRs (재배정) |
|---|---|---|---|---|---|
| **S0** | Foundation Sync | 1주 | 1주 | +0 | **ADR-141** (본 ADR) |
| **S1** | Demo-Breaking Hotfix + Circle annulus | **3~4주** | 4~5주 | +55 | **ADR-142, 143, 144, 145** |
| S2 | Input Step 1+2 | 2~3주 | 6~8주 | +30 | ADR-146, 147, 148 |
| S3 | Topology Cleanup Step 3 | 3~4주 | 9~12주 | +50 | ADR-149, 150, 151 |
| S4 | Healing Pipeline Step 4 | 3~4주 | 12~16주 | +60 | ADR-152, 153, 154 |
| **S4.5** | Curve-to-Curve Face Split | 4~6주 | 16~22주 | +30 | **ADR-155** |
| **S5** | 곡면 face + Sketch + Ellipse + Surface Push/Pull | **3~4주** | 19~26주 | +75 | **ADR-156, 157, 158, 159** |
| S6 | Annotation + Polish + Release | 2~3주 | 21~29주 | +30 | ADR-160, 161 |
| **합계** | **Production-grade RC** | **21~29주** | **5~7개월** | **+330** | **21 ADRs** (ADR-141~161) |

## 3. ADR-141~161 reserve 매트릭스 (정정 후)

본 계획 전용으로 21개 ADR 번호 reserve. 다른 트랙은 ADR-162+ 사용.

| ADR | 제목 | Sprint | 기간 |
|---|---|---|---|
| **ADR-141** | **Master Roadmap (본 ADR)** | **S0** | 1주 |
| ADR-142 | Closed-curve face split 5 함수 hotfix (시나리오 1) | S1 | 1~2주 |
| ADR-143 | Surface-aware getDrawPlane 곡면 chord 해소 (ADR-140 β 자연 후속) | S1 | 1주 |
| ADR-144 | Step 4.65 silent dissolve 회귀 자산 (PR #144 이어서) | S1 | 3일 |
| **ADR-145** | **Circle annulus 명시 활성 (옵션 B, 결재 1)** | **S1** | **3~5일** |
| ADR-146 | Step 1 Inferencing 보강 (node, latency, Recency) | S2 | 1주 |
| ADR-147 | Step 2 Scenario B1 (spatial-hash 1μm → 0.1μm) | S2 | 1주 |
| ADR-148 | B-γ' Point-Localized BoundaryTool (ADR-139 자연 후속) | S2 | 1주 |
| ADR-149 | T-junction Sweep 명시 도구 | S3 | 1주 |
| ADR-150 | 자동 Coplanar Face Merge (opt-in, 메타-원칙 #16 정합) | S3 | 1주 |
| ADR-151 | Connected Stacked-inner Component-Merge Resolver (LOCKED #1 deferred boundary) | S3 | 2주 |
| ADR-152 | P7-M4/M5 + Euler/Genus 모듈 | S4 | 2주 |
| ADR-153 | Best-fit Plane SVD + Pullback | S4 | 1주 |
| ADR-154 | Mesh::heal() 통합 entry | S4 | 1주 |
| **ADR-155** | **Curve-to-Curve Face Split (10 sub-step)** | **S4.5** | **4~6주** |
| ADR-156 | 곡면 위 Sketch + Sphere/Cylinder Mode | S5 | 2주 |
| ADR-157 | OCCT BRepFeat_SplitShape 활용 | S5 | 1주 |
| **ADR-158** | **DrawEllipseTool — NURBS-only (옵션 A, 결재 2)** | **S5** | **5~7일** |
| **ADR-159** | **Surface-aware Push/Pull** | **S5** | **1~2주** |
| ADR-160 | 영구 Annotation Entity | S6 | 1주 |
| ADR-161 | Face 위 Hole Pattern Array | S6 | 1주 |

## 4. Sprint 0 closure 의미 (본 ADR 산출물)

본 ADR 자체가 Sprint 0 의 최종 closure deliverable.

### Sprint 0 5 sub-step 결산

| Sub-step | 의도 | 실제 결과 | 상태 |
|---|---|---|---|
| **α** | git pull --ff-only origin main (158 commits behind 해소) | 167 commits behind → 0 (708b1c1) | ✅ Closed |
| **β** | PR #140 merge (시나리오 3 owner_id propagation) | 본 세션 PR #140 (K3) 이미 main merge (2026-05-21 05:37 UTC) | ✅ Auto-closed |
| **γ** | 3 worktree (elated-poitras / nervous-bose / tender-chaum) closure 결정 | nervous-bose-14363c = main merge ✅, elated-poitras + tender-chaum = 별도 audit deferred | ⚠ Partial (2 worktree deferred) |
| **δ** | git config core.autocrlf input | `core.autocrlf input` 설정 완료 (cross-platform safe) | ✅ Closed |
| **ε** | ADR-100 master roadmap + LOCKED #65 신설 | **ADR-141** master roadmap (본 ADR, 정정) + LOCKED #65 (CLAUDE.md) | ✅ Closed |

### audit-first canonical 16번째 적용 (메타-finding)

본 ADR 작성 직전 발견된 architectural finding (Sprint 0 audit 결과):

| 외부 agent 계획 | 실제 main 상태 | finding |
|---|---|---|
| ADR-101~123 reserve | ADR-100~140 all used | **23 번호 모두 충돌** |
| ADR-100 Master Roadmap | ADR-100 = material-removal-recovery (LOCKED #38) | ❌ 충돌 |
| "ADR-127~140 등이 worktree에" | ADR-100~140 in **main** (worktree → already main) | severity underestimate |
| PR #140 merge | PR #140 (K3) 이미 main merge | β step auto-closed |

→ **외부 agent 가 본 worktree 의 stale main (73c004e) 만 보고 계획 작성**. 본 세션 α (git pull) 후 자연 정정 가능했고, **재배정 ADR-141~161 적용** 으로 5/5 결재 의도 완전 보존.

## 5. 메타-원칙 #16 정합 강화 (canonical anchor)

### 면 생성 정책 옵션 B (결재 1) — 휴리스틱 vs 명시

| 자동화 후보 | 메타-원칙 #16 분류 | 정책 |
|---|---|---|
| 큰 Circle + 작은 Circle 내포 → 자동 annulus | **휴리스틱** | ❌ 폐기 |
| 사용자 우클릭 "annulus 만들기" → promote | **명시 의도** | ✅ canonical |

→ ADR-145 (Circle annulus) 는 ADR-139 (Boundary tool) 패턴 1:1 mirror.

### 모든 자동 trigger default OFF + opt-in (canonical for all Sprint ADRs)

본 roadmap 의 모든 ADR 은 다음 정책 강제:
- 휴리스틱 자동화 도입 시 → 메타-원칙 #16 정합 *명시 검증* 필수
- 자동 trigger default OFF (ADR-049 P-5e-α + ADR-139 B-β 패턴 답습)
- localStorage opt-in preference (ADR-049 P-5e-α canonical)
- Cascading risk 0 증명 의무 — failure mode 명시

## 6. 회귀 정책 강화 (절대 #[ignore] 금지 330/330)

### 회귀 분포 매트릭스 (예상)

| Sprint | 회귀 분배 | 누적 |
|---|---|---|
| S0 (본 ADR) | +0 (docs only) | +0 |
| S1 | +55 (Demo hotfix + Circle annulus) | +55 |
| S2 | +30 (Input Step 1+2) | +85 |
| S3 | +50 (Topology Cleanup) | +135 |
| S4 | +60 (Healing Pipeline) | +195 |
| S4.5 | +30 (Curve-to-curve face split) | +225 |
| S5 | +75 (곡면 face + Ellipse + Surface Push/Pull) | +300 |
| S6 | +30 (Annotation + Polish + Release) | **+330** ✅ |

### 회귀 자산 강제 (canonical for all Sprint ADRs)

본 roadmap 의 모든 ADR 은 다음 정책 강제:
- **절대 #[ignore] 금지** — 메타-원칙 #9 + #10
- Engine layer (axia-core / axia-geo / axia-wasm) + TS layer (vitest) +
  Playwright E2E 의 3-layer atomic coverage
- 사용자 시연 게이트 (ADR-087 K-ζ canonical) — Sprint 종료 시점 필수
- Visual baseline (ADR-077 V-2) — 영향 받는 시나리오만 regenerate

## 7. Path Z atomic sub-step pattern (canonical for all Sprint ADRs)

본 roadmap 의 모든 ADR 은 Path Z atomic 패턴 답습:

```
α (spec) → β (engine impl) → γ (WASM bridge) → δ (TS bridge)
        → ε (UI/Tool integration) → ζ (회귀 자산 + 사용자 시연) → η (closure)
```

각 sub-step:
- **단일 atomic PR** (LOCKED #44 Complete Meaning per Merge)
- **사전 audit** (audit-first canonical 16번째 적용 답습)
- **사용자 결재** (사용자 명시 진행 권한 받은 후 진행)
- **회귀 자산 단조 증가** (절대 #[ignore] 금지)

## 8. Cross-link

### LOCKED 정책 정합 (변경 불가 강제)

본 roadmap 의 모든 ADR 은 다음 LOCKED 정책 정합 강제:

- LOCKED #1 ADR-021 P7 (Closed Edge Loop Divides Face — superseded by ADR-139)
- LOCKED #5 (1.5μm spatial-hash dedup)
- LOCKED #7 ADR-026 P12 (Cardinal plane SSOT)
- LOCKED #14 메타-원칙 #14 (면은 닫힌 경계로 유도된다 — WHAT layer)
- LOCKED #15 P22.5 ADR-037 (Owner-ID uniformity)
- LOCKED #16 ADR-038 P23 (Surface-aware normals)
- LOCKED #26 ADR-049 (Two-Layer Citizenship)
- LOCKED #43 ADR-103 (Z-up Coordinate)
- LOCKED #44 (Complete Meaning per Merge)
- LOCKED #45 ADR-111 (BVH defer to idle)
- LOCKED #63 (z=0 invariant — DrawRect/Line/Circle cardinal force)
- LOCKED #64 ADR-139 (Boundary-only Face Synthesis — WHEN layer)

### 메타-원칙 정합

- 메타-원칙 #5 (사용자 편의 — 명확하면 자동, 모호하면 명시 동의)
- 메타-원칙 #9 (회귀 없음 — 테스트 통과 후 commit)
- 메타-원칙 #10 (ADR 불변 — 변경 시 새 ADR + Superseded)
- 메타-원칙 #11 (Latency Budget First)
- 메타-원칙 #12 (Memory Budget Per Subsystem)
- 메타-원칙 #14 (면은 닫힌 경계로 유도된다 — WHAT)
- 메타-원칙 #15 (동일 분할 = 동일 topological contract)
- 메타-원칙 #16 (자동화 antipattern — WHEN)

### 보고서 anchor (4 reports)

- `reports/최종_결재완료_Sprint0_시작.html` — 5/5 결재 lock-in
- `reports/Sprint0_Kickoff_Guide.html` — Sprint 0 procedure (정정 후 적용)
- `reports/마스터_완성계획.html` — 6 Sprint roadmap (Sprint 4.5 추가 7 Sprint)
- `reports/곡선면_도형그리기_완성계획.html` — 큰원/작은원 + 입체 옆면 + 타원/자유곡선 audit

### Cross-ADR 답습

본 roadmap 의 모든 ADR 은 다음 ADR pattern 답습:
- ADR-049 P-5e-α — engine default OFF + production default ON via localStorage
- ADR-074 — 5-layer atomic (Model + UI + Routing + Functional E2E + Visual)
- ADR-078 — 6-layer persistence 변형
- ADR-091 §E L1 — Mesh-level Map canonical (additive only, snapshot 호환)
- ADR-094 §E L1 — additive-first + multi-gate atomic
- ADR-097/100 — 5-Layer Atomic Stack (auto-recovery 패턴)
- ADR-099 — 6-Layer Atomic Stack (feature evolution)
- ADR-101 9-PR series — atomic decomposition canonical
- ADR-103 stacked PR pattern — multi-week atomic queue management
- ADR-104 family — 1:1 mirror template reproduction (Cylinder → Sphere → Cone → Torus)
- ADR-118/119/126/128/132/133 — α spec → β impl atomic pattern
- ADR-125/126/127/131 — audit-first canonical pivot pattern
- ADR-139 — WHAT/WHEN layer 분리 + 메타-원칙 #16 anchor
- ADR-140 — Surface-aware getDrawPlane (본 세션 산출물, S1 자연 후속)

## 9. Acceptance Log

### Sprint 0 (1주, 2026-05-22 ~ 2026-05-29)

| Sub-step | Commit | 산출물 |
|---|---|---|
| α (git pull) | (operations only) | main 167 commits behind 해소 → 0 |
| β (PR #140 merge) | 23a9808 (PR #140, 2026-05-21 auto-closed) | K3 시나리오 3 hotfix surface_owner_id propagation 6 split sites |
| γ (worktree closure) | nervous-bose merged, elated/tender deferred | ✅ 1 closed + ⚠ 2 deferred (별도 audit) |
| δ (core.autocrlf) | (config only) | `core.autocrlf input` (cross-platform safe) |
| **ε (본 ADR)** | (본 commit) | ADR-141 + LOCKED #65 + README catalog update |

### S1 ~ S6 Acceptance (향후 작성)

각 Sprint 종료 시 본 ADR 의 §9 에 추가 entry 작성 — Sprint 진입 결재 +
sub-step commit hash + 회귀 카운트 + 사용자 시연 evidence.

## 10. Lessons (canonical for future external-agent integration ADRs)

### L1 — Audit-first canonical 16번째 적용 (외부 계획 vs main 현실)

외부 agent 계획 도착 → **즉시 git state audit** (worktree main = stale
73c004e, 167 commits behind). 결과 — ADR 번호 23개 충돌 발견 + 사용자
5/5 결재 의도 보존 가능한 정정 plan (ADR-141~161 재배정) 산출.

→ 향후 모든 외부 agent 계획 도착 시 **본 패턴 default**:
1. 본 worktree 의 main commit hash 확인 (git log)
2. origin/main vs local main commit count 확인 (git status / git rev-list)
3. 외부 계획의 ADR 번호 reserve ↔ main ADR 카탈로그 cross-check
4. 충돌 발견 시 의도 보존 + 번호 재배정 plan 제시 (silent strip 회피)

### L2 — 5/5 결재 의도 보존 정책 (architectural value)

외부 agent 계획의 *번호 영역* 은 운영 문제, *의도* 는 architectural
가치. 본 ADR 은:
- **의도 보존** (5/5 결재 모두 ADR-145/158/159 + Sprint 1+1주 / 5+1주 / 21~29주 / +330 유지)
- **운영 영역만 정정** (ADR 번호 ADR-101~123 → ADR-141~161)

→ 향후 모든 외부 plan integration ADR 은 *의도/번호* 분리 lock-in.

### L3 — Sprint 0 의 architectural 가치 (Foundation Sync ≠ throwaway)

Sprint 0 (Foundation Sync) 는 단순 git pull/cleanup 이 아닌:
- 외부 agent 계획 ↔ main 현실 정합 anchor
- 모든 후속 Sprint 진입의 sole pre-condition
- LOCKED #65 신설로 architectural anchor 강제

→ 향후 모든 major external-agent integration 의 **사전 Sprint 0
유형 step 강제** (audit-first canonical 정합).

### L4 — Worktree 다중 운영 의 architectural risk

본 세션 3 worktree 운영 (nervous-bose / elated-poitras / tender-chaum)
중 nervous-bose 만 origin/main 정합. 다른 2 worktree (각 854/702
commits behind origin/claude/zealous-boyd) 는 별도 audit deferred —
work 가치 보존 vs main merge 가능성 별도 결재 필요.

→ 향후 worktree closure 결정은 **별도 audit ADR (LOCKED #44 정합)** 강제.

### L5 — 메타-원칙 #16 정합 강제 (모든 Sprint ADRs)

본 roadmap 의 21 ADR 모두 메타-원칙 #16 정합 강제:
- 자동 trigger 도입 시 → 휴리스틱 분류 audit
- Default OFF + localStorage opt-in canonical
- Cascading risk 0 증명 의무
- 사용자 명시 의도 path 우선

→ ADR-139 (Boundary tool, WHEN layer 신설) 이 본 roadmap 전체의 anchor.

### L6 — Path Z atomic + LOCKED #44 정합 강제

본 roadmap 의 모든 ADR 은 Path Z atomic sub-step (α~η) + LOCKED #44
Complete Meaning per Merge 강제:
- 단일 atomic PR per sub-step
- 사전 audit + 사용자 결재 cycle
- 회귀 자산 단조 증가 (절대 #[ignore] 금지)
- 사용자 시연 게이트 (ADR-087 K-ζ canonical)

→ 본 roadmap 의 architectural value = **5/5 결재 의도 + Path Z atomic
+ LOCKED #44 + 메타-원칙 #16 의 동시 활성**.

### L7 — Multi-week atomic decomposition (Sprint 4.5 anchor)

Sprint 4.5 (Curve-to-Curve Face Split, ADR-155) 는 4~6주 multi-week
atomic. ADR-094 §E L1 (additive-first + multi-gate atomic) 패턴 답습:
- 10 sub-step (α/β/γ/δ/ε/ζ/η/θ/ι/κ) 분할
- 각 sub-step 사용자 결재 (4~6주 동안 4~6회 결재)
- additive-first 위험 격리

→ Sprint 4.5 의 multi-week atomic 가 본 roadmap 의 architectural depth
demonstration.

## 11. 변경 시 필수 절차 (메타-원칙 #10 정합)

본 ADR 변경 시:
1. 사용자 **명시적 확인** 요청 ("Master Roadmap 을 변경하시겠습니까?")
2. 사용자 동의 시 진행
3. 변경 시 새 ADR 작성 (본 ADR 은 `Superseded by ADR-XXX` 표시)
4. CLAUDE.md LOCKED #65 업데이트
5. 변경 사유 + 영향 범위 commit message 명시

## 12. Out of scope (deferred to separate ADRs)

본 ADR scope 외 (모두 별도 트랙):

- **Sprint 0 γ (worktree closure)**: elated-poitras + tender-chaum
  closure 결정 — 별도 audit ADR
- **Sprint 1~6 본격 implementation**: 본 ADR 은 reserve + plan 만,
  실제 ADR-142~161 작성은 각 Sprint 진입 시점
- **회귀 +330 분배 세부**: Sprint 진입 시 각 ADR α spec 에서 결정
- **사용자 시연 게이트 세부**: 각 Sprint 종료 시점에서 정의
- **5/5 결재 외 추가 결재**: Sprint 진입마다 ADR α spec → 사용자 결재
  → β implementation cycle

각 deferred 항목은 별도 audit ADR + 사용자 결재 + 별도 PR.
