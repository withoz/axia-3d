/**
 * ExportUtils — Shared download helpers for all export formats.
 */

/** Download a text string as a file */
export function downloadText(content: string, filename: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

/** Download a Blob/ArrayBuffer as a file */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Generate a timestamped filename: AXiA_3D_20260413T231500.ext */
export function timestampedName(ext: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  return `AXiA_3D_${ts}.${ext}`;
}
