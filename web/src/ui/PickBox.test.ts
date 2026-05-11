import { describe, it, expect, beforeEach } from 'vitest';
import { PickBox } from './PickBox';

describe('PickBox', () => {
  let container: HTMLElement;
  let pickBox: PickBox;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Mock getBoundingClientRect
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    pickBox = new PickBox(container);
  });

  describe('constructor', () => {
    it('appends circle element to container', () => {
      expect(container.children.length).toBe(1);
    });

    it('circle starts hidden', () => {
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.display).toBe('none');
    });
  });

  describe('visible', () => {
    it('defaults to false', () => {
      expect(pickBox.visible).toBe(false);
    });

    it('setting true shows circle', () => {
      pickBox.visible = true;
      expect(pickBox.visible).toBe(true);
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.display).toBe('block');
    });

    it('setting false hides circle', () => {
      pickBox.visible = true;
      pickBox.visible = false;
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.display).toBe('none');
    });
  });

  describe('update', () => {
    it('positions circle at cursor when visible', () => {
      pickBox.visible = true;
      pickBox.update(100, 200);
      const circle = container.firstElementChild as HTMLElement;
      // Default size is 12, floor(12/2) = 6 → half offset
      expect(circle.style.left).toBe('94px');
      expect(circle.style.top).toBe('194px');
    });

    it('does nothing when not visible', () => {
      pickBox.update(100, 200);
      const circle = container.firstElementChild as HTMLElement;
      // Position should not be set (no style.left)
      expect(circle.style.left).toBe('');
    });
  });

  describe('setSize', () => {
    it('changes circle dimensions', () => {
      pickBox.setSize(20);
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.width).toBe('21px'); // 20 | 1 = 21
      expect(circle.style.height).toBe('21px');
    });

    it('ensures odd size via bitwise OR', () => {
      pickBox.setSize(10);
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.width).toBe('11px'); // 10 | 1 = 11
    });
  });

  describe('setColor', () => {
    it('changes border color', () => {
      pickBox.setColor('#ff0000');
      const circle = container.firstElementChild as HTMLElement;
      expect(circle.style.borderColor).toBe('rgb(255, 0, 0)');
    });
  });

  describe('dispose', () => {
    it('removes circle from DOM', () => {
      pickBox.dispose();
      expect(container.children.length).toBe(0);
    });
  });
});
