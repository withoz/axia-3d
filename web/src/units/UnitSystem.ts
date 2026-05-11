/**
 * AXiA 3D — Unit System
 *
 * 기본 단위: mm (밀리미터), 소수점 4째자리까지
 * 지원 단위: mm, cm, m, in, ft
 */

export type UnitType = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface UnitConfig {
  type: UnitType;
  label: string;
  labelLong: string;
  /** 1 내부단위(mm)를 이 단위로 변환하는 계수 */
  fromMM: number;
  /** 이 단위를 mm로 변환하는 계수 */
  toMM: number;
}

const UNIT_DEFS: Record<UnitType, UnitConfig> = {
  mm: { type: 'mm', label: 'mm',  labelLong: '밀리미터 (mm)', fromMM: 1,          toMM: 1          },
  cm: { type: 'cm', label: 'cm',  labelLong: '센티미터 (cm)', fromMM: 0.1,        toMM: 10         },
  m:  { type: 'm',  label: 'm',   labelLong: '미터 (m)',      fromMM: 0.001,      toMM: 1000       },
  in: { type: 'in', label: 'in',  labelLong: '인치 (in)',     fromMM: 1 / 25.4,   toMM: 25.4       },
  ft: { type: 'ft', label: 'ft',  labelLong: '피트 (ft)',     fromMM: 1 / 304.8,  toMM: 304.8      },
};

export class UnitSystem {
  private _unit: UnitType = 'mm';
  private _precision: number = 4; // 소수점 자릿수
  private _gridSnap: boolean = true;
  private _snapInterval: number = 1; // mm 단위 스냅 간격
  private _listeners: Array<() => void> = [];

  constructor() {
    // localStorage에서 설정 복원 시도
    this.loadFromStorage();
  }

  /** 현재 단위 */
  get unit(): UnitType { return this._unit; }
  set unit(v: UnitType) {
    if (this._unit !== v && UNIT_DEFS[v]) {
      this._unit = v;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  /** 소수점 자릿수 (0~8) */
  get precision(): number { return this._precision; }
  set precision(v: number) {
    const clamped = Math.max(0, Math.min(8, Math.round(v)));
    if (this._precision !== clamped) {
      this._precision = clamped;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  /** 스냅 활성화 */
  get gridSnap(): boolean { return this._gridSnap; }
  set gridSnap(v: boolean) {
    this._gridSnap = v;
    this.saveToStorage();
    this.notifyListeners();
  }

  /** 스냅 간격 (내부 mm 단위) */
  get snapInterval(): number { return this._snapInterval; }
  set snapInterval(v: number) {
    this._snapInterval = Math.max(0.0001, v);
    this.saveToStorage();
    this.notifyListeners();
  }

  /** 현재 단위 설정 정보 */
  get config(): UnitConfig { return UNIT_DEFS[this._unit]; }

  /** 모든 단위 목록 */
  static get allUnits(): UnitConfig[] {
    return Object.values(UNIT_DEFS);
  }

  /** 내부값(mm)을 현재 단위로 변환 */
  fromInternal(mm: number): number {
    return mm * this.config.fromMM;
  }

  /** 현재 단위 값을 내부값(mm)으로 변환 */
  toInternal(value: number): number {
    return value * this.config.toMM;
  }

  /** 내부값(mm)을 현재 단위 문자열로 포매팅.
   *  2026-04-27: 천자리 콤마 추가 — "1,234.5678" 식. 사용자 요청. */
  format(mm: number, showUnit = true): string {
    const converted = this.fromInternal(mm);
    // 천자리 콤마 — 정수부에만 적용. toFixed 결과의 "1234567.890" 같은
    //   문자열을 정수/소수부로 분리 후 정수부에 regex 로 콤마 삽입.
    const fixed = converted.toFixed(this._precision);
    const dot = fixed.indexOf('.');
    const intPart = dot >= 0 ? fixed.slice(0, dot) : fixed;
    const fracPart = dot >= 0 ? fixed.slice(dot) : '';
    const sign = intPart.startsWith('-') ? '-' : '';
    const absInt = sign ? intPart.slice(1) : intPart;
    const withCommas = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formatted = `${sign}${withCommas}${fracPart}`;
    return showUnit ? `${formatted} ${this.config.label}` : formatted;
  }

  /** 값에 스냅 적용 (내부 mm 단위) */
  snap(mm: number): number {
    if (!this._gridSnap || this._snapInterval <= 0) return mm;
    return Math.round(mm / this._snapInterval) * this._snapInterval;
  }

  /** 사용자 입력 파싱 → 내부값(mm) 반환 */
  parseInput(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    // 단위 접미사 체크
    for (const [key, def] of Object.entries(UNIT_DEFS)) {
      if (trimmed.endsWith(key)) {
        const numStr = trimmed.slice(0, -key.length).trim();
        const val = parseFloat(numStr);
        return isNaN(val) ? null : val * def.toMM;
      }
    }
    // 단위 없으면 현재 단위로 간주
    const val = parseFloat(trimmed);
    return isNaN(val) ? null : this.toInternal(val);
  }

  /** 변경 리스너 등록 */
  onChange(fn: () => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  private notifyListeners() {
    for (const fn of this._listeners) fn();
  }

  private saveToStorage() {
    try {
      const data = {
        unit: this._unit,
        precision: this._precision,
        gridSnap: this._gridSnap,
        snapInterval: this._snapInterval,
      };
      localStorage.setItem('axia3d-units', JSON.stringify(data));
    } catch { /* ignore */ }
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem('axia3d-units');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.unit && UNIT_DEFS[data.unit as UnitType]) this._unit = data.unit;
      if (typeof data.precision === 'number') this._precision = Math.max(0, Math.min(8, data.precision));
      if (typeof data.gridSnap === 'boolean') this._gridSnap = data.gridSnap;
      if (typeof data.snapInterval === 'number') this._snapInterval = Math.max(0.0001, data.snapInterval);
    } catch { /* ignore */ }
  }
}
