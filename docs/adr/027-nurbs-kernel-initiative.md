# ADR-027: NURBS Kernel Initiative — Kickoff

**Status**: **Accepted** (2026-04-29) — 사용자 승인 완료, Phase A 즉시 시작
**Plan**: [PLAN-001](../plans/PLAN-001-nurbs-kernel.md)
**Related**: ADR-007/019/021/025/026 (모두 보존)

## Context

AXiA 3D 의 현재 엔진은 DCEL polygon 기반:
- 원 / 호는 N-segment polyline 으로 tessellate
- 곡면 (cylinder, sphere) 은 triangle mesh
- 산업 CAD (SolidWorks, Fusion, Rhino) 는 NURBS B-rep 으로 분석적 표현

사용자가 산업 CAD 동급 정밀도를 위해 자체 NURBS 커널 작성을 결정.

## Decision

### 자체 NURBS 커널 작성 — 옵션 A 채택

외부 의존 (truck / OCCT) 없이 Rust 로 직접 구현. PLAN-001 의 7-Phase
점진 진화 채택.

### 채택 이유
- ✅ 라이선스 완전 자유 (MIT 등 채택 가능)
- ✅ AXiA 의 LOCKED 정책 / ADR invariants 와 직접 호환
- ✅ 학습 / 통제 가치 — 핵심 기술 자산
- ✅ 점진 진화 — 각 Phase 자급자족 (멈춰도 OK)

### 거부된 대안
- **truck 통합**: 외부 의존, AXiA invariants 와 wrapper 필요
- **OCCT 통합**: LGPL, 10MB+ WASM 번들, ABI 통과 비용
- **현 polygon 유지**: 사용자 정확도 요구 미충족

## Phasing

PLAN-001 의 7 Phases (각 Phase 별 별도 ADR-028~035):

| Phase | 기간 | 산출물 |
|---|---|---|
| A | 3 mo | Analytic edge curve (Line/Arc/Circle) |
| B | 3 mo | Bezier / B-spline curves |
| C | 3 mo | NURBS curves + CCI |
| D | 6 mo | Analytic surface primitives |
| E | 6 mo | NURBS surfaces (trimmed) |
| F | 9 mo | Surface-Surface Intersection |
| G | 6 mo | NURBS Boolean + STEP/IGES |

**Total**: 36 개월 (자체 핵심), 60+ 개월 (산업 동급)

## Decision Gates

각 Phase 끝에서 **계속 진행 vs 외부 통합 전환** 결정:
- Gate 1 (Month 3): Phase A 결과로 Phase B 진행 여부
- Gate 2 (Month 9): Curve only 로 멈춤 여부
- Gate 3 (Month 21): SSI (Phase F) 자체 vs truck/OCCT
- Gate 4 (Month 36): 산업 robustness 추가 투자 여부

## Constraints (Locked)

이 Initiative 는 다음을 **준수해야 함**:

1. **메타-원칙 #1** (기존 명령 호환) — 기존 polygon 동작 100% 유지
2. **메타-원칙 #4** (SSOT) — Analytic curve/surface 가 truth, polyline/mesh 는 cache
3. **메타-원칙 #7** (Topology > Cache) — DCEL 위상 그대로, 곡선/곡면 은 Edge/Face 의 추가 reference
4. **메타-원칙 #9** (회귀 없음) — 각 Phase 회귀 0건 + 100+ 신규 테스트
5. **메타-원칙 #10** (ADR 불변) — 각 Phase 별 ADR 작성 + LOCKED 갱신
6. **LOCKED #5** (Mesh exact input) — NURBS 도 exact input, fuzzy snap 금지
7. **LOCKED #7 / ADR-026** (Cardinal SSOT) — Bridge 계층 SSOT 유지
8. **ADR-007** (Face Orientation) — NURBS 곡면도 winding 일관 (CCW outer)
9. **ADR-019** (Line is Truth) — Curve 도 동등 1급 — Line 은 curve 의 특수 case
10. **ADR-021** (P7 Closed loop divides face) — 곡선 닫힌 loop 도 면 분할
11. **ADR-025** (P11 Closed edge cycle MUST face) — NURBS edge 도 동일 invariant

## Migration Strategy

- 기존 polygon mesh 는 변경 없음
- `Edge.curve: Option<AnalyticCurve>` — None 이면 기존 직선 동작
- `Face.surface: Option<AnalyticSurface>` — None 이면 기존 polygon
- 모든 새 도구 (DrawArc / DrawCircle / DrawBezier) 는 Phase 진행 따라
  자동으로 분석적 표현 생성
- Push/Pull / Boolean / merge 는 Phase F 까지 NURBS edge/surface 만나면
  자동 tessellate (호환 모드)

## Risks

PLAN-001 §6 참조:
- **R1 (높음)**: SSI 수치 robustness — Phase F 위험 게이트
- **R2 (높음)**: NURBS Boolean corner case
- **S1 (높음)**: Phase F 1년+ 지연 가능성

## Success Criteria

- 각 Phase 종료 시 회귀 0건 + 100+ 신규 테스트
- 사용자 가치 (Phase 별 마일스톤) 충족
- LOCKED 정책 / ADR invariants 무손상

## Decision Required

이 ADR 채택 시 다음이 즉시 활성화:
1. ADR-027 → Accepted
2. PLAN-001 → Approved
3. **Phase A kickoff** (ADR-028 작성, 첫 코드 commit 1개월 내)

**대기 사항**: 사용자 명시 승인 + Phase A 시작 시점 결정

## References

- PLAN-001 (전체 계획서)
- Piegl & Tiller, *The NURBS Book* (Springer 1997)
- Patrikalakis & Maekawa, *Shape Interrogation for CAD/CAM* (Springer 2002)
- 메타-원칙 #1~#13
- 기존 ADR-007/019/021/025/026 (호환 보장)
