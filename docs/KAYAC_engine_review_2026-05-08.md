# KAYAC (AIStudio/AIDEA) 엔진 검토 보고서

**검토일**: 2026-05-08
**대상 경로**: `E:\kayac` (AIStudio = 브랜드 AIDEA)
**검토 관점**: AXiA 3D 와의 architectural 비교

---

## 📋 프로젝트 개요

KAYAC 는 Web/Desktop hybrid CAD/디자인 도구로, 다음 스택을 사용:

| 항목 | 내용 |
|---|---|
| Frontend | **React 19** + TypeScript + Vite + Three.js + R3F |
| Geometry Kernel | **buildragon** (Rust DCEL, 별도 crate `native/buildragon`) |
| Render Engine | **Rust + WGPU 25.0** custom pipeline (WGSL, MSAA) |
| Desktop | Electron 36 + native C++ addon |
| Native Integration | SketchUp SDK direct binding (`.skp` parsing) |
| Build | wasm-pack + cmake-js + electron-builder |
| AI | OpenAI + Claude API service modules |
| i18n | 4 languages (KO/EN/JA/ZH, i18next) |

---

## 🏗️ 아키텍처 비교 (KAYAC vs AXiA 3D)

### Geometry Kernel (DCEL 핵심)

| 측면 | KAYAC `buildragon` | AXiA `axia-geo` |
|---|---|---|
| Storage | `slotmap` `HopSlotMap` + `CayaSlot` (자체) | `SlotStorage` (자체) |
| HE 구조 | DCEL twin/next/prev 완전 wired | DCEL twin/next/prev/next_rad |
| Triangulation | earcutr | earcutr (동일) |
| Math | glam32 + glam64 dual ext | glam (DVec3 단일) |
| Tolerances | tolerances.rs 모듈 | tolerances.rs 모듈 |
| Transactions | `transaction_manager.rs` | `axia-transaction` 별도 crate |
| Files (src/) | ~30 files (caya_entities.rs alone 3232 lines) | 더 modularized (별도 ops/ 디렉토리) |
| **NURBS** | **불가시 — polygonal mesh focus** | **ADR-027 Phase A~G 완성** |
| **Closed-curve native** | 불가시 | **ADR-089 (1 anchor + 1 self-loop edge)** |

### Render Pipeline

| 측면 | KAYAC | AXiA 3D |
|---|---|---|
| Backend | **Custom Rust + WGPU 25** | Three.js (WebGL, EffectComposer) |
| Shaders | **WGSL custom** | Three.js built-in materials |
| MSAA | Custom MSAA pipeline | EffectComposer samples=4 |
| WebGPU | **Yes (WGPU `webgpu` feature)** | No (Three.js WebGL only) |
| Initial bundle | (Electron desktop, large) | **252 kB initial** (P20.C #2 lock) |

### Frontend / UX

| 측면 | KAYAC | AXiA 3D |
|---|---|---|
| Framework | React 19 + R3F (`@react-three/fiber`) | Vanilla TS (no React) |
| UI lib | Radix UI + Tailwind + DaisyUI | Custom panels |
| State | React Context + Hooks | ServiceContainer DI |
| Pages | N1~N5 editors (multi-page) | Single SPA viewport |
| Resizable panels | react-resizable | Custom DraggablePanelManager |

### Native Integration

| 측면 | KAYAC | AXiA 3D |
|---|---|---|
| Desktop | **Electron + C++ addon (CMake)** | (planned future) |
| SketchUp SDK | **`SketchUpAPI.framework` direct linking** | JSZip 기반 OPC 압축 해제 |
| `.skp` fidelity | High (SDK native) | Low (placeholder geometry) |

---

## 💪 KAYAC 의 강점 (AXiA 가 배울 점)

1. **WGPU custom renderer** (`native/rust/src/renderer/`)
   - WebGPU 차세대 API 활용 (Three.js 의존성 우회)
   - WGSL 셰이더 커스터마이징 (PBR, MSAA, post-processing)
   - 산업 CAD 수준 렌더 품질 잠재력

2. **SketchUp SDK 직접 연결**
   - `.skp` 파일을 native API 로 직접 파싱
   - Component/Group hierarchy 보존

3. **i18n 4 언어 지원** (KO/EN/JA/ZH)
   - `i18next` 표준 채택
   - AXiA 는 KO+EN 만 (ADR-046 Phase 2)

4. **AI 통합 architectural 설계**
   - `services/openaiApi.ts` + `services/claudeApi.ts` 패턴
   - 실시간 AI assist 모듈 통합

5. **모듈형 multi-page editor** (N1~N5)
   - 페이지 별 독립 editor

6. **Multi-platform Electron** (Mac/Windows/Linux NSIS)
   - Production-ready desktop deployment

---

## 🎯 AXiA 3D 의 강점 (KAYAC 에 대한 architectural 우위)

1. **NURBS 분석 kernel 완성도** (ADR-027 Phase A~G)
   - Analytic Curves (Line/Circle/Arc/Bezier/BSpline/NURBS)
   - Analytic Surfaces (Plane/Cylinder/Sphere/Cone/Torus/BezierPatch/BSpline/NURBS)
   - SSI (Surface-Surface Intersection)
   - NURBS Boolean (ADR-064/066)
   - KAYAC `buildragon` 은 polygonal-only 로 보임

2. **STEP/IGES 정통 import** (ADR-081~086)
   - OCCT.js Stage 4-A 본체 활성
   - Curve/Surface promotion 11+12 매핑
   - Owner-ID 매핑 (P22 Pick→Promote)

3. **메타-원칙 #14 + Closed-curve 시민권** (ADR-089)
   - 1 anchor + 1 self-loop edge with AnalyticCurve
   - Smooth-group edge hiding, uv-slice tessellation
   - 4 곡면 도형 일관 처리

4. **MCP capability surface** (ADR-041~044)
   - AI agent ↔ Engine integration
   - Capability ALLOW/DENY policy
   - npm publish flow

5. **ADR-driven governance** (89 ADRs)
   - 모든 architectural 결정 문서화
   - LOCKED policies (#1~#35) 봉인
   - 회귀 자산 누적 (axia-geo 1175+, vitest 1629+)

6. **Initial bundle 0MB 강제** (ADR-035 P20.C #2)
   - 252 kB initial JS, 5MB+ OCCT lazy load

7. **Two-Layer Citizenship Model** (ADR-049/050)
   - Form layer (Shape) vs Property layer (Xia)

8. **Cardinal Plane SSOT** (ADR-026 P12)
   - Bridge layer 단일 진실 원천

---

## ⚠️ 위험 / 개선 영역

### KAYAC 의 잠재적 약점

1. **NURBS 부재**: `buildragon` 의 30+ 파일 모두 polygonal mesh ops. 진정한 CAD parity 위해 NURBS kernel 추가 필요.
2. **STEP/IGES**: 가시적 OCCT 통합 흔적 없음 — 산업 CAD 호환성 제한.
3. **ADR governance 부재**: PROJECT_ANALYSIS.md 만 있고, 결정 이력 추적 불가능.
4. **Electron-bound**: Browser-first 사용자 onboarding 어려움.
5. **C++ 의존**: native addon 빌드 환경 진입 장벽 높음.

### AXiA 의 잠재적 약점 (KAYAC 대비)

1. **Renderer 한계**: Three.js WebGL → WGPU 마이그레이션 시 큰 전환 비용.
2. **`.skp` fidelity**: SketchUp SDK 직접 통합 부재.
3. **Desktop**: Electron/Tauri 미구현.
4. **i18n**: 2 언어만.
5. **React ecosystem 부재**: 커스텀 UI 의 maintainability 제약.

---

## 📊 architectural 정합성 점수 (주관적 평가)

| 영역 | KAYAC | AXiA 3D |
|---|---|---|
| Render Quality | ★★★★★ (WGPU custom) | ★★★☆☆ (Three.js) |
| Geometry Kernel 깊이 | ★★★☆☆ (polygonal 위주) | ★★★★★ (NURBS Phase A~G) |
| File Format 호환 | ★★★★☆ (.skp native + Three.js loaders) | ★★★★☆ (DXF/DWG + STEP/IGES) |
| Desktop 완성도 | ★★★★★ (Electron + native) | ★★☆☆☆ (planned) |
| Web onboarding | ★★☆☆☆ (Electron-bound, 큰 bundle) | ★★★★★ (252 kB initial) |
| AI 통합 | ★★★★☆ (OpenAI+Claude API service) | ★★★★★ (MCP capability surface) |
| ADR governance | ★☆☆☆☆ | ★★★★★ (89 ADR + 35 LOCKED) |
| 회귀 자산 | (불가시) | ★★★★★ (3000+ tests) |
| i18n | ★★★★☆ (4 langs) | ★★☆☆☆ (2 langs) |
| Industry CAD parity | ★★★☆☆ | ★★★★☆ (NURBS + STEP) |

---

## 🎯 architectural 권고

### KAYAC 가 채택 가능한 AXiA 패턴

1. **NURBS kernel 도입** — `buildragon` 에 `surfaces/` 디렉토리 추가, ADR-027 패턴 답습
2. **OCCT.js STEP/IGES** — Stage 4-A scaffolding
3. **ADR governance** — `docs/adr/` 디렉토리 + decision log
4. **MCP capability surface** — AI agent 표준화
5. **Closed-curve kernel-native** (ADR-089) — Circle 도구의 자동 곡선 처리

### AXiA 가 채택 가능한 KAYAC 패턴

1. **WGPU custom renderer** — long-term 마이그레이션 ADR
2. **SketchUp SDK native binding** — `.skp` fidelity 향상
3. **i18n 확장** — JA/ZH 추가
4. **React migration** — 또는 Web Components 패턴 채택
5. **Electron desktop** — Tauri 대안 ADR

### 두 엔진의 보완 가능성

- KAYAC 의 **render+desktop+i18n** 강점 + AXiA 의 **kernel+ADR+MCP** 강점 = 이상적 조합.
- 별개 엔진으로 발전 (각 페르소나/시장 차별화) 또는 collab/merge 가능성 모두 viable.

---

## 🏁 핵심 결론

KAYAC 는 **렌더링 품질 + 데스크톱 통합 + i18n** 우월, AXiA 는 **kernel 깊이 + governance + browser-first + AI 통합** 우월.

시장 포지셔닝 다름:
- **KAYAC**: SketchUp 대체 desktop CAD (AIStudio = native rich client)
- **AXiA**: 웹 기반 modeling + AI collaborative (browser-first + MCP)

직접 경쟁보다 **차별화 path** 가 자연. 양 엔진 각각의 강점을 보존하며 약점을 상호 학습하는 architectural 권고.

---

*검토자: Claude (AXiA 3D session, ADR-089 A-α~A-φ closure context)*
*검토 범위: `E:\kayac` directory structure + Cargo.toml + package.json + PROJECT_ANALYSIS.md*
*제약: 사용자 facing 코드 (UI, runtime behavior) 직접 시연 검증은 본 검토 범위 외*
