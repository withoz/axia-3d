# Architecture Decision Records (ADR)

이 디렉토리는 AXiA 3D 엔진의 주요 설계 결정을 기록합니다.

## 목적
- 왜 그 결정을 내렸는지 **맥락과 근거**를 남겨, 미래의 재검토 시 배경을 잃지 않기 위함
- 설계 원칙에 예외가 생기는 경우, 그 이유를 추적 가능하게 함
- 신규 기여자가 "왜 이렇게 되어 있나?"를 빠르게 파악

## 포맷
각 ADR은 다음 구조를 따릅니다:

- **상태(Status)** — Proposed / Accepted / Superseded / Deprecated
- **날짜(Date)** — 결정 시점
- **맥락(Context)** — 왜 이 결정이 필요했는가
- **결정(Decision)** — 무엇을 선택했는가
- **근거(Rationale)** — 왜 그것을 선택했는가
- **결과(Consequences)** — 긍정/부정적 파생 효과
- **대안(Alternatives)** — 고려했지만 선택하지 않은 것들
- **관련 기록(Related)** — 다른 ADR, 커밋, 이슈

## 색인

| # | 제목 | 상태 |
|---|-----|-----|
| [ADR-001](./001-geometry-semantic-layer-separation.md) | Geometry/Semantic 레이어 분리 원칙 | Accepted |
| [ADR-002](./002-xia-state-from-face-count.md) | XIA 상태는 면 개수로 계산 | Accepted |
| [ADR-003](./003-geometric-validity-principle.md) | Geometric Validity Principle (Degenerate 방지) | Accepted |
| [ADR-004](./004-xia-level-stable-id.md) | 안정 ID는 XIA-level만 (Face GUID 금지) | Accepted |
| [ADR-005](./005-coplanar-merge-purely-geometric.md) | Coplanar Merge는 순수 기하 연산 | Accepted |

## 변경 규칙
- 기존 ADR을 **수정하지 않음**. 설계가 바뀌면 새 ADR을 작성하고 이전 것을 `Superseded`로 표시.
- ADR 번호는 단조 증가. 결번 없음.
