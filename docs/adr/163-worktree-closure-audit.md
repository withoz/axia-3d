# ADR-163 — Worktree Closure Audit (elated-poitras + tender-chaum + nervous-bose)

**Status**: Draft (spec only — 사용자 결재 후 actual closure 진행)
**Date**: 2026-05-22
**Author**: WYKO + Claude
**Track**: Track 3 (사용자 결재 다중 트랙 병행 진행, 2026-05-22 휴식 후)
**Trigger**: 사용자 요청 "Sprint 0 γ deferred 2 worktree closure 결정"
+ 본 세션 audit-first canonical 20번째 적용.
**Sprint allocation**: ADR-141 §3 Sprint 0 γ deferred 의 자연 후속.
ADR-141~161 reserve 외 별도 트랙 (operational hygiene, 회귀 +0).

## Canonical anchor (사용자 결재 + audit-first 20번째)

> 사용자 결재 (2026-05-22 휴식 후):
> "ADR-163 spec 작성 (worktree audit). 사용자 결재 후 closure 결정."

**Sprint 0 γ deferred audit** 의 자연 후속. 3 worktree (elated-poitras
/ nervous-bose-14363c / tender-chaum-78d041) 의 main 통합 가능성 + 작업
가치 + closure 안전성 audit.

## 1. Audit 결과 매트릭스

### 1.1 3 worktree 현재 상태

| Worktree | Branch | HEAD | ahead origin/main | behind origin/main | merge-base = HEAD? | Status |
|---|---|---|---|---|---|---|
| **nervous-bose-14363c** (본 세션) | feat/adr-163-spec | 73b40c7+ | 0 | 0 | ✅ (origin/main 정합) | **활성 작업 중** |
| **elated-poitras** | claude/elated-poitras | 3be91fe | **0** | 1057 | ✅ (3be91fe = ancestor) | **stale checkout** |
| **tender-chaum-78d041** | claude/tender-chaum-78d041 | 70e1730 | **0** | 905 | ✅ (70e1730 = ancestor) | **stale checkout** |

### 1.2 핵심 finding (audit-first 20번째)

**elated-poitras HEAD (3be91fe) merge-base with origin/main = 3be91fe**
(HEAD 자체) → HEAD 가 origin/main 의 **직계 ancestor**.

**tender-chaum HEAD (70e1730) merge-base with origin/main = 70e1730**
(HEAD 자체) → HEAD 가 origin/main 의 **직계 ancestor**.

→ **두 worktree 모두 작업 손실 0** — 모든 commits 가 origin/main 의
linear history 에 포함. (Branch SHA 가 main 의 historical 시점일 뿐,
divergent work 없음.)

### 1.3 작업 내용 (history reference, audit evidence)

#### elated-poitras (claude/elated-poitras)

최근 5 commits (HEAD 부터):
```
3be91fe Fix ortho viewport: dynamic depth, axis sync, zoom clamp
3627604 Rotate grid to match view plane in ortho views
3968b45 Fix drawing on wrong plane in Front/Right/Left views
2e8f663 Fix grid/axis invisible in ortho views
76a480e Reduce ortho camera far=1000, dist=500 for proper clipping range
```

→ Viewport ortho fix 트랙. 모든 commits 가 origin/main 에 이미 통합.

#### tender-chaum-78d041 (claude/tender-chaum-78d041)

최근 5 commits (HEAD 부터):
```
70e1730 Bend / Twist / Taper — non-linear vertex deformers (옵션 C)
3e98cc5 PBR + IBL + Soft Shadow — viewport rendering upgrade (옵션 B)
77193e4 Fillet — round off a convex edge with a tangent arc surface
26495af Stabilization + perf batch — audit 우선 항목 5건
558dbae Toolbar: Organic group with Mirror / Revolve / Subdivide actions
```

→ Organic primitives + PBR+IBL + Catmull-Clark 트랙. 모든 commits 가
origin/main 에 이미 통합.

## 2. Closure decision matrix

### 2.1 옵션 비교

| 옵션 | 작업 | 위험 | 회귀 | 권장 |
|---|---|---|---|---|
| **A. Safe closure (delete)** | `git worktree remove` (each) + remote branch delete (gh) | 0 (work 이미 main) | 0 | ✅ **Recommended** |
| B. Pull latest main + keep | `git pull --ff-only` (each) — main 동기화 | 작업 영역 disk 점유 유지 | 0 | 비활성 일 시 disk waste |
| C. Hold for future work | 그대로 유지 (stale) | drift 누적 + .git lock conflict risk | 0 | ❌ 비추천 |

### 2.2 권장 옵션 A 의 구체적 단계

```bash
# 1. elated-poitras closure
git worktree remove "E:/AXiA 3D/.claude/worktrees/elated-poitras"
gh api -X DELETE repos/withoz/axia-3d/git/refs/heads/claude/elated-poitras  # remote branch delete
git branch -D claude/elated-poitras  # local branch delete (if exists)

# 2. tender-chaum closure
git worktree remove "E:/AXiA 3D/.claude/worktrees/tender-chaum-78d041"
gh api -X DELETE repos/withoz/axia-3d/git/refs/heads/claude/tender-chaum-78d041
git branch -D claude/tender-chaum-78d041

# 3. nervous-bose-14363c (본 세션) — Sprint 1 종료 후 별도 closure
# 본 세션 작업 종료 시점에서 별도 결재
```

### 2.3 nervous-bose-14363c 별도 처리

본 worktree (nervous-bose-14363c) 는 **현재 활성 작업 중** (Sprint 1
+ Track 2/3 + 향후 ADR-142~145 implementations). Sprint 1 종료 후
별도 결재로 closure — 본 ADR scope 외.

## 3. 안전성 검증 (closure 전 사용자 시연 게이트)

### 3.1 작업 손실 0 evidence (canonical)

```bash
git -C "E:/AXiA 3D/.claude/worktrees/elated-poitras" rev-list --left-right --count origin/main...HEAD
# Output: 1057  0
#         ^^^^  ^
#         |     `-- HEAD 가 origin/main 보다 ahead 한 commit 수 (= 0)
#         `------- origin/main 이 HEAD 보다 ahead 한 commit 수 (= 1057)
```

→ ahead 0 = **HEAD 의 모든 commits 가 origin/main 에 포함**. Branch
delete 시 git GC 후에도 commits 는 main 의 history 에서 영구 보존.

### 3.2 사용자 시연 게이트 (ADR-087 K-ζ canonical)

closure 전 사용자가 *직접 확인* 권장:

1. **elated-poitras 최근 작업 검증**:
   - GitHub: https://github.com/withoz/axia-3d/commits/main → "Ortho viewport" 키워드 검색
   - 3be91fe / 3627604 / 3968b45 commits 가 main 에 보이면 OK
2. **tender-chaum 최근 작업 검증**:
   - "Bend / Twist / Taper" / "PBR + IBL" / "Catmull-Clark" 키워드 검색
   - 70e1730 / 3e98cc5 / d10387c commits 가 main 에 보이면 OK
3. 두 worktree 의 코드 변경 사항이 main 에 *통합되어 있음* 확인 후 closure 진행

## 4. Closure 후 효과

| 항목 | Before closure | After closure |
|---|---|---|
| Active worktree 수 | 3 | 1 (nervous-bose-14363c 만) |
| Disk 점유 (각 worktree ~5GB) | ~15GB | ~5GB (-10GB) |
| .git/packed-refs 라인 | 다수 stale | 정합 |
| 다중 worktree git lock conflict risk | 있음 (이전 Sprint 0 α `index.lock` stale 사례) | 0 |
| 다음 작업 entry 시 mental load | 어느 worktree 로 진입할지 결정 | 1 worktree (명확) |

## 5. Lock-ins

- **L-163-1** Closure 권장 = Safe deletion (옵션 A). 두 worktree 모두 작업 손실 0 evidence 명확.
- **L-163-2** Branch delete 는 local + remote 양쪽 — gh CLI 사용 (canonical: `gh api -X DELETE refs/heads/<branch>`).
- **L-163-3** nervous-bose-14363c 별도 처리 — Sprint 1 종료 후 별도 ADR (본 ADR scope 외).
- **L-163-4** 사용자 시연 게이트 (ADR-087 K-ζ) — closure 전 GitHub 에서 작업 commits 가 main 에 통합 확인 권장 (사용자 안심).
- **L-163-5** Closure 후 commits 영구 보존 (git GC + main history 정합) — 작업 손실 risk 0.
- **L-163-6** ADR-046 P31 #4 additive only — 사용자 외부 API + 작업 자체 영향 0. 운영 hygiene 만.
- **L-163-7** 회귀 +0 — code 변경 0, docs only.
- **L-163-8** Sprint allocation 외 별도 트랙 — ADR-141~161 reserve 영향 0.
- **L-163-9** LOCKED #44 (Complete Meaning per Merge) — 본 ADR 자체 + actual closure 분리 PR (사용자 결재 cycle 분리).

## 6. Out of scope (deferred)

- **nervous-bose-14363c (본 worktree) closure** — Sprint 1 종료 시점 별도 ADR
- **새 worktree 생성 정책** — 별도 ADR (다중 worktree 운영의 architectural guidance)
- **.git/packed-refs maintenance** — 사용자 요청 별도 트랙 (병행 가능)
- **CI worktree integration** — 별도 ADR (현재 CI 는 main checkout 만 사용)

## 7. 변경 시 필수 절차 (메타-원칙 #10)

본 ADR 변경 시:
1. 사용자 **명시적 확인** 요청
2. 사용자 동의 시 진행
3. 변경 시 새 ADR 작성 (본 ADR 은 `Superseded by ADR-XXX` 표시)
4. 변경 사유 + 영향 범위 commit message 명시

## 8. Acceptance Log

### α (spec only — 본 commit)

- **Trigger**: 사용자 결재 (2026-05-22 휴식 후 다중 트랙 병행) + audit-first 20번째 적용
- **산출물**: 본 ADR doc (~200 lines)
- **회귀**: +0 (docs only)
- **다음 step**: 사용자 결재 후 actual closure (Safe deletion 옵션 A)

### β (actual closure — 사용자 결재 후 별도 PR)

각 worktree closure 시 본 §8 에 추가 entry — `git worktree remove` 결과
+ branch delete 결과 + post-closure git state evidence.

## 9. Lessons (audit-first canonical 20번째)

**L1 — 다중 worktree 운영의 architectural cost**: 본 세션 3 worktree
운영 중 2 worktree 가 stale (1057 / 905 commits behind). Sprint 0 α
`index.lock` stale 사례에서 이미 lock conflict risk 발견. 향후 worktree
운영 정책 강화 — *최대 1~2 worktree* 권장.

**L2 — merge-base = HEAD 의 architectural 의미**: stale worktree HEAD
가 origin/main 의 ancestor 일 때 **작업 손실 0 보장**. 향후 worktree
closure 결정 시 `git merge-base HEAD origin/main` 으로 evidence 확보.

**L3 — Branch delete 의 local + remote 동시성**: `git worktree remove`
만으로는 remote branch 잔존. `gh api -X DELETE refs/heads/<branch>`
명시 cleanup 강제.

**L4 — Sprint 0 γ deferred 의 자연 closure**: ADR-141 §3 Sprint 0 γ
가 "deferred 별도 audit" 명시 → 본 ADR 이 그 후속. Sprint 0 의 architectural
debt 의 자연 closure (LOCKED #44 + LOCKED #65 정합).

**L5 — 사용자 시연 게이트 운영 의 architectural value (ADR-087 K-ζ canonical
20번째 답습)**: closure 같은 destructive ops 도 사용자 결재 + 사전
evidence 검증 + actual ops 의 3단계 cycle 강제. 본 ADR α 가 evidence
spec, β 가 actual ops.
