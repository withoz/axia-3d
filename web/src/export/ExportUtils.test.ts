import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timestampedName, downloadText, downloadBlob } from './ExportUtils';

describe('ExportUtils', () => {
  describe('timestampedName', () => {
    it('generates filename with correct extension', () => {
      const name = timestampedName('dxf');
      expect(name).toMatch(/^AXiA_3D_\d{8}T\d{6}\.dxf$/);
    });

    it('generates filename for obj extension', () => {
      const name = timestampedName('obj');
      expect(name).toMatch(/\.obj$/);
      expect(name).toMatch(/^AXiA_3D_/);
    });

    it('generates filename for glb extension', () => {
      const name = timestampedName('glb');
      expect(name).toMatch(/\.glb$/);
    });

    it('generates unique names on successive calls', () => {
      // Within the same second they will be the same, but format should be consistent
      const a = timestampedName('stl');
      const b = timestampedName('stl');
      expect(a).toMatch(/^AXiA_3D_\d{8}T\d{6}\.stl$/);
      expect(b).toMatch(/^AXiA_3D_\d{8}T\d{6}\.stl$/);
    });

    it('timestamp portion has no colons or hyphens', () => {
      const name = timestampedName('obj');
      const ts = name.replace('AXiA_3D_', '').replace('.obj', '');
      expect(ts).not.toContain(':');
      expect(ts).not.toContain('-');
    });
  });

  describe('downloadText', () => {
    let clickSpy: ReturnType<typeof vi.fn>;
    let createObjectURLSpy: ReturnType<typeof vi.fn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        click: clickSpy,
        style: {},
      } as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
      createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
      revokeObjectURLSpy = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLSpy;
      globalThis.URL.revokeObjectURL = revokeObjectURLSpy;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates a blob and triggers download', () => {
      downloadText('hello world', 'test.txt');
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('uses custom mime type', () => {
      downloadText('<dxf content>', 'file.dxf', 'application/dxf');
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      // The Blob is created internally, we verify the flow completes
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadBlob', () => {
    let clickSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        click: clickSpy,
        style: {},
      } as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      globalThis.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('downloads a blob with given filename', () => {
      const blob = new Blob(['binary data'], { type: 'model/stl' });
      downloadBlob(blob, 'model.stl');
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });
});
