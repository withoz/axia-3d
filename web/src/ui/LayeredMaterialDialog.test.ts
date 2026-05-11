/**
 * ADR-099 L-ε — LayeredMaterialDialog tests (jsdom).
 *
 * Pure helper unit tests (parseProjectionInput, parseScaleInput) +
 * end-to-end flow with prompt + file picker mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseProjectionInput,
  parseScaleInput,
  openLayeredChannelDialog,
} from './LayeredMaterialDialog';

describe('LayeredMaterialDialog (L-ε)', () => {
  describe('parseProjectionInput', () => {
    it('null on cancel', () => {
      expect(parseProjectionInput(null)).toBeNull();
    });
    it('"1" → planar', () => {
      expect(parseProjectionInput('1')).toBe('planar');
    });
    it('"2" → box', () => {
      expect(parseProjectionInput('2')).toBe('box');
    });
    it('"3" → cylindrical', () => {
      expect(parseProjectionInput('3')).toBe('cylindrical');
    });
    it('unknown → planar (default fallback)', () => {
      expect(parseProjectionInput('99')).toBe('planar');
      expect(parseProjectionInput('xyz')).toBe('planar');
      expect(parseProjectionInput('  1  ')).toBe('planar');
    });
  });

  describe('parseScaleInput', () => {
    it('null on cancel', () => {
      expect(parseScaleInput(null)).toBeNull();
    });
    it('valid positive number', () => {
      expect(parseScaleInput('0.001')).toBe(0.001);
      expect(parseScaleInput('5')).toBe(5);
    });
    it('null on zero / negative', () => {
      expect(parseScaleInput('0')).toBeNull();
      expect(parseScaleInput('-1')).toBeNull();
    });
    it('null on NaN / invalid', () => {
      expect(parseScaleInput('foo')).toBeNull();
      expect(parseScaleInput('')).toBeNull();
    });
  });

  describe('openLayeredChannelDialog (end-to-end with mocks)', () => {
    let promptSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      document.body.innerHTML = '';
    });

    afterEach(() => {
      promptSpy?.mockRestore();
    });

    it('returns null when no file selected', async () => {
      // Mock pickImageFile by patching input.click() to immediately
      // fire `cancel` event. The dialog adds the input to body, so we
      // observe and respond.
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'input') {
          setTimeout(() => el.dispatchEvent(new Event('cancel')), 0);
        }
        return el;
      });
      const result = await openLayeredChannelDialog('albedo');
      expect(result).toBeNull();
    });

    it('returns null when projection prompt cancelled', async () => {
      // Mock file picker → return a fake File.
      const fakeFile = new File(['hello'], 'tex.png', { type: 'image/png' });
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'input') {
          setTimeout(() => {
            // Force files property.
            Object.defineProperty(el, 'files', {
              value: [fakeFile], configurable: true,
            });
            el.dispatchEvent(new Event('change'));
          }, 0);
        }
        return el;
      });
      // FileReader mock.
      const origReader = global.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).FileReader = class {
        result = 'data:image/png;base64,STUB';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() { setTimeout(() => this.onload?.(), 0); }
      };
      // Projection prompt → null (cancel).
      promptSpy = vi.spyOn(window, 'prompt').mockReturnValueOnce(null);

      const result = await openLayeredChannelDialog('normal');
      expect(result).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).FileReader = origReader;
    });

    // NOTE: Full happy-path E2E (file → projection → scale → result)
    // requires deep jsdom mocking of FileReader + input.click + prompt.
    // The pure helpers (parseProjectionInput, parseScaleInput) +
    // 2 cancel-path tests above cover the deterministic branches.
    // Real-runtime verification is L-η (Playwright Real Chromium).
  });
});
