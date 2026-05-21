# ADR-014 — 메타-원칙 확장 (#11, #12, #13)

**Status**: Accepted (2026-04-27, Sprint 1)
**Date**: 2026-04-27
**Axis**: 모든 축 (메타)
**Related**: 기존 메타-원칙 #1~#10

---

## 컨텍스트

기존 메타-원칙 10개는 *결정 기준*으로서 잘 동작한다. 그러나 ADR-010 ~ ADR-013을 도출하면서 **세 가지 새로운 결정 기준**이 반복적으로 등장했다:

1. "이 작업은 16ms 안에 끝나야 한다" — 정량적 기준
2. "이 자료구조는 어디까지 커져도 되는가?" — 메모리 기준
3. "이 데이터는 어디에 사는가?" — 물리적 위치 기준

이를 메타-원칙으로 승격해서 *모든 향후 ADR이 참조*할 수 있도록 한다.

## 결정

기존 메타-원칙에 다음 3개를 추가한다:

### #11 — Latency Budget First

> 모든 사용자 입력은 정해진 latency budget 안에 끝낸다.
> Hover 16ms / Click 33ms / Commit 100ms / Heavy 500ms.
> 위반은 에러가 아니라 강등(degradation) 트리거다.

**적용 시점**: 새 명령/도구 추가 시 budget 위반 가능성을 검토 → 위반 시 ADR-012 강등 정책에 따라 Worker offload / progressive / preview-only 중 선택.

### #12 — Memory Budget Per Subsystem

> **명명 정정 (2026-05-21, 보고서 P4 High)**: 이전 명칭 "Per Entity" 는
> ADR-013 §1 내용 (Rust slot / Three.js / BVH / OperationLog 영역별
> budget) 과 mismatch — **Per Subsystem** 으로 정정. Per-entity (Vertex/
> Edge/Face/Shape/Xia 단위) 와 Per-subsystem (Rust slot 80MB 등) 은 다른
> 추상화 레벨. ADR-013 본문은 이미 정합.

> 모든 자료구조는 명시적 cap을 가진다. Cap이 없는 자료구조는 ADR 위반이다.
> 글로벌 메모리 예산을 두고, soft/hard limit에 따라 eviction이 발동한다.

**적용 시점**: 새 cache / map / list 추가 시 cap과 eviction 정책 명시 — ADR 또는 코드 주석에 기록.

### #13 — One Source, Two Views

> 동일 데이터는 한 곳에만 저장한다.
> Rust = 진실(truth), JS = 뷰(view).
> 캐시는 휘발성(refresh 시 폐기), 저장 대상이 아니다.

**적용 시점**: 새 데이터 도입 시 "어디가 truth인가?"를 먼저 정한다. 캐시는 SSOT가 아니다.

## 메타-원칙 전체 목록 (#1~#13)

| # | 원칙 | 축 |
|---|------|-----|
| 1 | 기존 명령은 모두 그대로 | 호환 |
| 2 | 외부 참조는 형태/모양만 | 호환 |
| 3 | 상태바는 보호 | UX |
| 4 | 단일 진실 원천 (SSOT) | 일관성 |
| 5 | 사용자 편의 최우선 | UX |
| 6 | Preventive over Curative | 안정성 |
| 7 | Topology > Cache | 일관성 |
| 8 | 즉각 반응 > 완전성 | UX/성능 |
| 9 | 회귀 없음 | 품질 |
| 10 | ADR 불변 | 거버넌스 |
| **11** | **Latency Budget First** | **성능** |
| **12** | **Memory Budget Per Subsystem** (명명 정정 2026-05-21) | **메모리** |
| **13** | **One Source, Two Views** | **메모리/일관성** |

## Amendment 1 (2026-05-21) — 메타-원칙 #14/#15/#16 추가 (보고서 P3 High + governance 정합)

본 ADR 의 메타-원칙 SSOT 가 #1~#13 까지만 명시되어 있으나, 2026-05-08
이후 #14/#15/#16 이 CLAUDE.md + README 에 추가됨. SSOT 분산 회피 위해
본 ADR amendment 로 등재.

### #14 — 면은 닫힌 경계로부터 유도된다 (Face derives from a closed boundary)

> **WHAT layer (결과 invariant, 불변)** — 평면적(coplanar) 닫힌 단순 경계
> 로부터 **disk-topology face** 가 유도된다. H₁=0 영역 한정 (Jordan-
> Schoenflies 정리 기반). Knotted curve / Plateau's problem / 비평면
> closed curve 는 명제 외부 (AxiA scope 외).

**Canonical statement (사용자 통찰, 2026-05-08; 학술적 정밀화 2026-05-21)**.
ADR-019 (Line is Truth, Face is Byproduct) 의 가장 본질 형태. ADR-088
P22.5 (curve_owner_id) / ADR-089 Phase 2 (true kernel-native closed
edges) 의 anchor.

**위상수학적 근거**: Jordan-Schoenflies 정리 — 평면 R² 의 simple closed
curve 는 inside (disk homeomorphic) + outside 로 분할. AxiA 의 coplanar
검사 (LOCKED #5 ε=1.5μm spatial-hash) 가 진입 가드 → 본질적으로 R²
환경. 자세한 학술적 정밀화는 CLAUDE.md 메타-원칙 #14 detail section 참조.

### #15 — 동일 분할 = 동일 topological contract

> **분할 정합** — 모든 split-type 함수 (Mesh::split_face / split_face_by_chain
> / split_face_case_b/c/d / auto_intersect_coplanar / Boolean split_faces_
> by_intersections / 향후 새 split 함수) 는 split-induced edges 에
> HeFlags::HARD flag 부여 동일 topological contract 준수.

**Canonical statement (사용자 결재, 2026-05-16, ADR-101 Amendment 9)**.
"빠르고 신속하고 정확" — 추가 분기 / lookup 없이 flag 1 bit 로 정확한
동작 보장 (force_hard fast-path, mesh.rs:5359). Performance + correctness
동시.

### #16 — 자동화 antipattern (WHEN layer, 신설)

> **WHEN layer (trigger 정책)** — 자동화는 사용자 의도를 미리 알 수 없다.
> 휴리스틱 자동화는 cascading 부작용의 source.

**Canonical statement (사용자 통찰 누적 + ADR-139 결재 2026-05-18)**.
P5.UX.39-45 cascading fixes 패턴 evidence + 사용자 RECT 시연 evidence
anchor. 메타-원칙 #5 ("명확하면 자동, 모호하면 명시 동의") 의 강화 —
"휴리스틱 자동화 = 모호" 임을 lock-in. 메타-원칙 #14 (WHAT) 와 직교 —
*결과* 보존, *trigger* 만 변경.

## 메타-원칙 전체 목록 (#1~#16, 2026-05-21 갱신)

| # | 원칙 | 축 |
|---|------|-----|
| 1 | 기존 명령은 모두 그대로 | 호환 |
| 2 | 외부 참조는 형태/모양만 | 호환 |
| 3 | 상태바는 보호 | UX |
| 4 | 단일 진실 원천 (SSOT) | 일관성 |
| 5 | 사용자 편의 최우선 | UX |
| 6 | Preventive over Curative | 안정성 |
| 7 | Topology > Cache | 일관성 |
| 8 | 즉각 반응 > 완전성 | UX/성능 |
| 9 | 회귀 없음 | 품질 |
| 10 | ADR 불변 | 거버넌스 |
| 11 | Latency Budget First | 성능 |
| 12 | **Memory Budget Per Subsystem** (명명 정정 2026-05-21) | 메모리 |
| 13 | One Source, Two Views | 메모리/일관성 |
| **14** | **면은 닫힌 경계로부터 유도된다** (WHAT, 2026-05-08, 학술적 정밀화 2026-05-21) | **기하 본질** |
| **15** | **동일 분할 = 동일 topological contract** (2026-05-16) | **분할 정합** |
| **16** | **자동화 antipattern** (WHEN, 2026-05-18 ADR-139) | **UX/거버넌스** |

## 호환성 검증

새 메타-원칙이 기존 #1~#10과 충돌하지 않는지 확인:

- **#11 vs #8**: #8("즉각 반응 > 완전성")의 *정량적 정의*가 #11. 충돌 X, 강화.
- **#12 vs #4**: #4(SSOT)는 *논리적*, #12는 *물리적*. 충돌 X, 보완.
- **#13 vs #1**: #1("기존 명령은 그대로")과 무관. 데이터 위치만 다룸.
- **#13 vs #7**: #7("Topology > Cache")의 일반화. 모든 cache는 휘발성.

## 결과

**긍정**
- 향후 모든 ADR이 13개 원칙으로 자가 검증 가능
- "이 결정의 근거가 뭔가?" → 메타-원칙 번호로 답변 가능
- Code review 시 PR 검토 기준이 명확

**부정**
- 메타-원칙 13개는 외울 양이 많음 — chear-sheet 필요 (별도 문서)

## 대안 (Alternatives)

- **메타-원칙 통합 (#11~#13 → 단일 #11)**: 추상화 ↑, 구분 ↓. 검색·인용 어려움. 기각.
- **메타-원칙 폐지, ADR 자체 인용만 사용**: 빠른 의사결정 시 추상화 부재. PR review 기준 약화. 기각.

## 재검토 트리거 (When to Revisit)

- 메타-원칙이 13개를 초과 (외울 양 폭증) → 관련 항목 통합 검토
- 새 메타-원칙 후보가 3 이상 누적 → 시리즈 ADR 작성

## 관련 기록 (Related)

- 기존 메타-원칙 #1~#10 (`CLAUDE.md`, ADR-007 Rev 2 7원칙)
- ADR-012 (#11 의 구체적 구현)
- ADR-013 (#12, #13 의 구체적 구현)
- ADR-019 / ADR-088 / ADR-089 (#14 의 anchor)
- ADR-101 Amendment 9 (#15 의 canonical)
- ADR-139 (#16 의 anchor)
- 보고서: `reports/엔진_개념_이론_검토_보고서.html` §1 메타-원칙 학술적 평가

## 메타-원칙 매핑

- #10 ADR 불변 — 이 ADR로 #11~#13 추가, 기존 #1~#10은 변경 없음 (Superseded 아님)
