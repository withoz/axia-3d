/**
 * AXiA 3D 공유 상수 — Rust `crates/axia-geo/src/tolerances.rs` 와 동기화
 *
 * **중요**: 이 파일의 값은 Rust 측과 반드시 일치해야 한다.
 * Rust 값을 변경하면 반드시 이 파일도 함께 업데이트.
 *
 * 자세한 설명과 상호 관계는 `tolerances.rs` 모듈 주석 참조.
 */

// ════════════════════════════════════════════════════════════════════════
// Tolerance (허용 오차) — 좌표 비교
// ════════════════════════════════════════════════════════════════════════

export const VERTEX_TOLERANCE = 1e-7;
export const EDGE_TOLERANCE = 1e-7;
export const FACE_TOLERANCE = 1e-6;
export const COPLANAR_TOLERANCE = 1e-4;

// ════════════════════════════════════════════════════════════════════════
// Epsilon (실효값 하한) — Geometric Validity Principle (ADR-003)
// ════════════════════════════════════════════════════════════════════════

/** 1D 실효 길이 하한. 이보다 짧은 거리는 "실질적으로 0"으로 간주. */
export const EPSILON_LENGTH = 1e-6;

/** 2D 실효 면적 하한 (EPSILON_LENGTH^2). */
export const EPSILON_AREA = EPSILON_LENGTH * EPSILON_LENGTH;

/** 3D 실효 부피 하한 (EPSILON_LENGTH^3). */
export const EPSILON_VOLUME = EPSILON_LENGTH * EPSILON_LENGTH * EPSILON_LENGTH;

/** 각도 비교 epsilon (도 단위). */
export const EPSILON_ANGLE_DEG = 0.01;

// ════════════════════════════════════════════════════════════════════════
// Angles (각도 임계값) — 렌더링 및 그룹핑
// ════════════════════════════════════════════════════════════════════════

/**
 * 엣지 가시성 임계 각도 (도). 인접 면 사이의 법선 각도가 이보다 작으면
 * 엣지를 숨긴다(soft edge / coplanar 취급). SketchUp 기본값.
 */
export const EDGE_VISIBILITY_ANGLE_DEG = 30.0;

/**
 * Smooth group 그룹핑 임계 각도 (도). BFS로 인접 면을 묶을 때 이보다
 * 작은 각도 차이를 가진 면들을 하나의 곡면 그룹으로 취급.
 *
 * 값: EDGE_VISIBILITY_ANGLE_DEG + 0.1° (저분할 원통/원뿔 경계 안정화)
 */
export const SMOOTH_GROUP_ANGLE_DEG = 30.1;

/**
 * 완전 코플래너 판정 임계 각도 (도). 두 면의 법선 각도 차이가 이보다
 * 작으면 "완전히 같은 평면"으로 간주 — 즉 분할된 sibling face로 판정.
 *
 * Smooth group에서 이 범위의 이웃은 **제외**된다 (2026-04-17 fix).
 */
export const EXACT_COPLANAR_ANGLE_DEG = 0.1;

// ════════════════════════════════════════════════════════════════════════
// 헬퍼 함수
// ════════════════════════════════════════════════════════════════════════

/** 도 → 라디안 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 도 → cosine (내적 비교용) */
export function degToCos(deg: number): number {
  return Math.cos(degToRad(deg));
}

/** 미리 계산된 각도별 cosine (자주 쓰이는 값 캐시) */
export const COS_EDGE_VISIBILITY = degToCos(EDGE_VISIBILITY_ANGLE_DEG);
export const COS_SMOOTH_GROUP = degToCos(SMOOTH_GROUP_ANGLE_DEG);
export const COS_EXACT_COPLANAR = degToCos(EXACT_COPLANAR_ANGLE_DEG);
