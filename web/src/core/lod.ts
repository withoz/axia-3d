/**
 * LOD (Level of Detail) — ADR-013 §5
 *
 * 큰 프로젝트에서 메모리 폭발을 막기 위해 XIA 마다 4 단계 LOD 운영.
 * 본 모듈은 *상태 기계 + 트리거 정책* 만 제공. 실제 데이터 보유/해제는
 * 호출자(Viewport / SnapManager / BVH)가 담당한다 — ADR-013 §5 의
 * "LOD 는 렌더/picking 측면, 토폴로지는 항상 Rust 에 full" 원칙 준수.
 *
 * 사용:
 *   const lod = new LodTracker();
 *   lod.update(xiaId, { screenAreaPx2, distance, isFrustumIn, isActive });
 *   const level = lod.get(xiaId);  // 0/1/2/3
 *   lod.onChange((id, oldLv, newLv) => { ...renderer가 반응... });
 */

export type LodLevel = 0 | 1 | 2 | 3;

export interface LodSignal {
  /** 화면 투영 면적 (픽셀² 단위, AABB 포함). */
  screenAreaPx2: number;
  /** 카메라 ↔ XIA 중심 거리 (mm). */
  distance: number;
  /** 카메라 frustum 안에 있는가. */
  isFrustumIn: boolean;
  /** 사용자가 현재 작업 중인 객체인가 (활성 XIA / 선택된 XIA). */
  isActive: boolean;
  /** 마지막 편집 후 경과 시간 (ms). */
  msSinceLastEdit?: number;
}

/** ADR-013 §5 임계값 — 실험으로 조정 가능. */
export const LOD_THRESHOLDS = {
  /** LOD 0 ↔ 1 전환 면적 (화면 영역). */
  fullArea: 100,    // px²
  /** LOD 1 ↔ 2 전환 면적. */
  visibleArea: 4,   // px²
  /** LOD 2 ↔ 3 거리 (frustum 안이지만 너무 멀면 hidden). */
  farDistance: 1_000_000,  // 1 km in mm
  /** 마지막 편집 후 BVH 해제까지 idle 시간. */
  idleBvhMs: 5 * 60 * 1000,  // 5 min
};

/**
 * Pure decision function: signal → desired LOD level.
 * Side-effect free — easy to unit-test.
 */
export function decideLod(s: LodSignal): LodLevel {
  if (!s.isFrustumIn) return 3;             // hidden 외부
  if (s.isActive)              return 0;    // 활성 작업 객체는 항상 full
  if (s.distance > LOD_THRESHOLDS.farDistance) return 2;   // 너무 멈
  if (s.screenAreaPx2 < LOD_THRESHOLDS.visibleArea) return 2;
  if (s.screenAreaPx2 < LOD_THRESHOLDS.fullArea)    return 1;
  return 0;
}

type LodChangeCb = (xiaId: number, prev: LodLevel, next: LodLevel) => void;

export class LodTracker {
  private levels = new Map<number, LodLevel>();
  private listeners: LodChangeCb[] = [];

  /** Apply signal to xia. Fires onChange when level changes. */
  update(xiaId: number, signal: LodSignal): LodLevel {
    const next = decideLod(signal);
    const prev = this.levels.get(xiaId);
    if (prev === next) return next;
    this.levels.set(xiaId, next);
    if (prev !== undefined) {
      for (const cb of this.listeners) cb(xiaId, prev, next);
    }
    return next;
  }

  /** Current LOD for xia (default 0 if never updated). */
  get(xiaId: number): LodLevel {
    return this.levels.get(xiaId) ?? 0;
  }

  /** Bulk current LOD map. */
  snapshot(): Map<number, LodLevel> {
    return new Map(this.levels);
  }

  /** Subscribe — returns unsubscribe fn. */
  onChange(cb: LodChangeCb): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  reset(): void { this.levels.clear(); }
  size(): number { return this.levels.size; }

  /** Bulk apply a frame's worth of signals. Returns the count of
   *  XIAs whose level changed (useful for renderer to decide if a
   *  re-paint is needed). */
  updateMany(signals: Map<number, LodSignal>): number {
    let changed = 0;
    for (const [id, sig] of signals) {
      const prev = this.levels.get(id);
      const next = decideLod(sig);
      if (prev !== next) {
        this.levels.set(id, next);
        if (prev !== undefined) {
          for (const cb of this.listeners) cb(id, prev, next);
        }
        changed++;
      }
    }
    return changed;
  }
}
