/**
 * SelectBox — CAD-style pick aperture circle.
 * Shows a small circle around the mouse cursor for edge/object picking.
 */

export class PickBox {
  private container: HTMLElement;
  private circle: HTMLDivElement;
  private _visible: boolean = false;
  // 원의 효과적 반지름 = 5 (stroke 1.5px 중심선 기준). Erase SVG 커서와 동일.
  private _size: number = 12;

  constructor(container: HTMLElement) {
    this.container = container;

    this.circle = document.createElement('div');
    Object.assign(this.circle.style, {
      position: 'absolute',
      pointerEvents: 'none',
      border: '1.5px solid #3a3a4a',
      width: `${this._size}px`,
      height: `${this._size}px`,
      borderRadius: '50%',
      zIndex: '9999',
      display: 'none',
      boxSizing: 'border-box',
    });
    container.appendChild(this.circle);
  }

  set visible(v: boolean) {
    this._visible = v;
    this.circle.style.display = v ? 'block' : 'none';
  }

  get visible(): boolean {
    return this._visible;
  }

  update(clientX: number, clientY: number) {
    if (!this._visible) return;
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const half = Math.floor(this._size / 2);
    this.circle.style.left = `${x - half}px`;
    this.circle.style.top = `${y - half}px`;
  }

  setSize(px: number) {
    this._size = px | 1;
    this.circle.style.width = `${this._size}px`;
    this.circle.style.height = `${this._size}px`;
  }

  setColor(color: string) {
    this.circle.style.borderColor = color;
  }

  dispose() {
    this.circle.remove();
  }
}
