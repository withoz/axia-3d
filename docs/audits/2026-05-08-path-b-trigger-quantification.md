# Path B 트리거 정량화 Audit (ADR-089 A-Γ + ADR-090 §6)

**Audit 일자**: 2026-05-08
**작성자**: AXiA team (사용자 결재 + Claude 측정)
**ADR 참조**: ADR-090 (Path B Deferred), ADR-089 (Path A LOCKED #35)
**목적**: ADR-090 §6 의 정량 트리거 명시 부분 채움 — Path A 의 polygonal
강등을 측정하고 Path B 진입 시점 결재의 데이터 anchor 확보

---

## 1. Audit 범위

| 측정 영역 | 측정 대상 | 측정 방법 |
|---|---|---|
| Geometric accuracy | Cylinder 의 polygonal 강등 (chord error, perimeter deviation) | 분석적 공식 + Path A primitive 측정 |
| Memory footprint | per-cylinder face/edge/vert count | `create_cylinder` 실행 후 active 카운트 |
| Path A vs Path B 비교 | Path B 산업 CAD parity (3 face / 2 edge / 2 vert) | 이론적 산업 CAD 표준 |

**Out of scope**:
- STEP/IGES full round-trip — STEP export 미구현
- 실제 사용자 모델 코퍼스 — 사용자 제공 시 추가
- 렌더 시간 측정 — 별도 performance audit

---

## 2. Geometric Accuracy 측정

### 2.1 공식

Chord error (sagitta) = `r × (1 - cos(π/N))` mm
Perimeter deviation = `2πr - 2Nr·sin(π/N)` mm

**핵심**: chord error 는 radius 에 비례, segments 에 quadratically 반비례.

### 2.2 Chord Error 측정 매트릭스

| Radius | N=8 | N=16 | N=32 | N=64 |
|---|---|---|---|---|
| **10 mm** | 0.761 mm (7.61%) | 0.192 mm (1.92%) | 0.0481 mm (0.48%) | 0.0120 mm (0.12%) |
| **50 mm** | 3.81 mm (7.61%) | 0.961 mm (1.92%) | 0.241 mm (0.48%) | 0.0602 mm (0.12%) |
| **100 mm** | 7.61 mm (7.61%) | 1.92 mm (1.92%) | 0.481 mm (0.48%) | 0.120 mm (0.12%) |
| **500 mm** | 38.1 mm (7.61%) | 9.61 mm (1.92%) | 2.41 mm (0.48%) | 0.602 mm (0.12%) |
| **1000 mm** | 76.1 mm (7.61%) | 19.2 mm (1.92%) | 4.81 mm (0.48%) | 1.20 mm (0.12%) |

### 2.3 분석

| 사이즈 | Path A 의 측정 한계 | 의미 |
|---|---|---|
| **R=10mm + N=64** | 0.012mm 오차 | 1mm 정밀 구조에서 1.2% 오차 — 조립 부적합 |
| **R=100mm + N=32** | 0.481mm 오차 | 일반 건축 0.5mm 허용 범위 ↔ 한계 |
| **R=1000mm + N=64** | 1.20mm 오차 | 1m 부재의 1.2mm 오차 — 정밀 CAD 부적합 |
| **R=1000mm + N=8** | **76mm 오차** | 7.6% 강등 — completely 부적합 |

**임계 trigger**: 사용자가 "1mm 이내 정밀도" 요구 + R > 100mm cylinder 사용 시 Path A 한계 명시 활성.

---

## 3. Memory Footprint 측정

### 3.1 Path A primitive 의 cylinder 토폴로지

`create_cylinder(R, h, N)` 의 face/edge/vert 산출:

| N | Path A faces | Path A edges | Path A verts | Path B (theoretical) |
|---|---|---|---|---|
| 8 | 24 (fan caps + sides) | ~40 | 18 | 3 / 2 / 2 |
| 16 | 48 | ~80 | 34 | 3 / 2 / 2 |
| 32 | 96 | ~160 | 66 | 3 / 2 / 2 |
| 64 | **192** | ~**320** | **130** | **3 / 2 / 2** |

(*Path A: fan caps (N triangles each) + N side quads + 2 fan center verts + 2N ring verts*)

### 3.2 절감률 (Path A vs Path B)

| N | Face 절감 | Edge 절감 | Vert 절감 |
|---|---|---|---|
| 8 | 87.5% | 95.0% | 88.9% |
| 16 | 93.8% | 97.5% | 94.1% |
| 32 | 96.9% | 98.7% | 97.0% |
| **64** | **98.4%** | **99.4%** | **98.5%** |

### 3.3 Large model 추론

**1000개 cylinder × N=32 mesh**:
- Path A: 96,000 face / 160,000 edge / 66,000 vert
- Path B: 3,000 face / 2,000 edge / 2,000 vert
- **메모리 절감 ~97% per geometric cost**

각 face/edge/vert struct 크기 추정:
- `Face`: ~80 bytes (loop ref + normal + material + flags)
- `Edge`: ~64 bytes (verts + curve enum + flags)
- `Vertex`: ~24 bytes (DVec3 + flags)

**1000-cylinder model 메모리 비교**:
- Path A: 96000×80 + 160000×64 + 66000×24 = ~19.5 MB (geometric only)
- Path B: 3000×80 + 2000×64 + 2000×24 = ~0.42 MB
- **47x 절감 ratio** (large model 영향 대형)

---

## 4. ADR-090 §6 정량 트리거 — 명시화 결과

### 4.1 트리거 매트릭스 (이전 § 6 의 추상 → 정량)

| 트리거 | Path A 한계 | Path B 가치 | 임계 활성 시점 |
|---|---|---|---|
| **STEP/IGES export 정확도** | polygon strip → analytic 손실 | 1:1 매핑 | STEP export 구현 후 |
| **Cylinder geometric 정확도** | R×(1-cos(π/N)) mm | 분석적 정확 | R > 100mm + 0.5mm 정밀도 요구 |
| **메모리 효율** | 96000 face / 1000-cyl model | 3000 face / 1000-cyl model | Large model (1000+ cylinders) 에서 47x 절감 |
| **Boolean 정확도** | chord 오차 누적 | analytic SSI ~0 | 0.1mm 이하 정밀 Boolean |
| **PMI / dimension 정확도** | "Φ200mm ± chord 오차" | 정확히 Φ200mm | ANSI/ISO 정밀 dimension |

### 4.2 사용자 facing 트리거 (정성)

| 시나리오 | Path A 한계 |
|---|---|
| AP242 STEP export 후 SolidWorks/Fusion 재import | cylinder 가 polygon mesh 로 손실 |
| 정밀 가공 도면 (PMI) | "Φ200mm" 가 polygon → 가공 정밀도 손실 |
| AI agent (MCP) 의 cylinder 정확 표현 요구 | "이건 진짜 cylinder 가 아니라 N-segment polygon" |
| 1000+ cylinder 가 포함된 large architectural model | 메모리 + render 비용 누적 |

### 4.3 ADR-090 §6 update 권장

ADR-090 §6 의 정량 트리거 표를 본 audit 결과로 업데이트:
- "STEP/IGES round-trip <1e-3 mm" → Path A 의 chord 오차 정량 명시
- "메모리 효율 8x" → 47x (large model 추론) 명시
- "Cylinder geometric 정확도" 신규 트리거 추가

---

## 5. 결론

### 5.1 현 시점 (2026-05-08) Path A 적합성

Path A 가 충분한 사용 시나리오:
- ✅ R < 50mm cylinder + N >= 32 (chord error < 0.25mm)
- ✅ 100mm scale 건축 모델 + 0.5mm 허용 정밀도
- ✅ Visual quality (A-ρ/τ/υ/φ 의 매끈 render)
- ✅ Functional (Boolean / Push-Pull / Offset 모두 동작)

Path A 가 한계 인식되는 시나리오:
- ❌ R > 100mm + 0.1mm 정밀도 요구
- ❌ 1000+ cylinder 의 large model
- ❌ AP242 STEP export 사용자
- ❌ 정밀 가공 PMI (Φ 정확)

### 5.2 Path B 진입 결재 권장 시점

다음 조건 중 **하나 이상** 명시 활성 시 ADR-090 진입 결재 권장:

1. STEP export 트랙 진입 결정 (현재 ADR-081/082 는 import only)
2. 사용자 large architectural model 메모리 audit 후 임계 초과
3. AI agent (MCP tier 2+) 가 분석적 cylinder 표현 요구
4. 정밀 CAD 사용자 명시 demand (PMI / 0.1mm 정밀도)

### 5.3 본 audit 의 의미

ADR-090 §6 의 추상적 트리거를 **정량 데이터** 로 강화:
- 각 트리거의 임계값 명시 (R, N, 정밀도)
- Path B 진입 ROI 명시화
- 향후 사용자 결재 시 데이터 anchor

---

## 6. 회귀 자산 (LOCKED #35 정합)

본 audit 의 측정은 다음 회귀 테스트로 봉인:

| Test | 영역 |
|---|---|
| `adr089_a_gamma_cylinder_chord_error_corpus` | 5×4=20 측정 포인트 |
| `adr089_a_gamma_cylinder_perimeter_deviation_corpus` | 3×4 perimeter |
| `adr089_a_gamma_cylinder_path_a_memory_footprint` | Path A face/edge/vert |
| `adr089_a_gamma_cylinder_per_segment_face_count` | baseline regression guard |
| `adr089_a_gamma_path_b_savings_table` | N별 절감률 |

**회귀**: axia-geo +5 (1189 → 1194). 절대 #[ignore] 금지 5/5.

향후 primitive 변경 시 측정값 자동 회귀 → audit 데이터 자연 갱신.

---

*Audit 결과 봉인 — ADR-090 의 §6 정량 트리거 anchor. 향후 Path B 진입
결재 시 본 문서 + 회귀 자산 활용.*
