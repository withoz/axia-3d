/**
 * LayeredMaterialDialog — ADR-099 L-ε.
 *
 * Per-channel upload dialog for the 4 PBR channels (Albedo / Normal /
 * Roughness / Metallic). Mirrors the existing `TextureUploadDialog`
 * prompt-flow pattern but scoped to a single channel — host code
 * (Inspector / AssetLibraryPanel) opens it 1..4 times to populate
 * the desired channels.
 *
 * Lock-ins applied (ADR-099):
 *   - L-F UI 진입점 — single-channel upload helper; multi-tab editor
 *     can wrap this in a 4× loop OR open per-channel as needed.
 *     1-tab default = Albedo only call site (legacy parity).
 *   - L-A 4 PBR channels fixed — channel name is type-safe
 *     `LayeredChannelName`
 *   - L-B serialization parity — returned `TextureInfo` matches the
 *     TS interface (same shape as Rust `TextureChannelInfo` for L-η
 *     round-trip)
 *   - ADR-091 §E L4 — UI orchestration 분리. Pure utility module
 *     (file picker + prompt + parse), host owns wiring to material
 *     library
 *
 * Out of scope:
 *   - Actual Material.visual.layered mutation (host responsibility —
 *     after this returns, host updates the material and triggers a
 *     re-render through bridge `setLayeredChannel`)
 *   - 4-tab modal UI (this MVP uses prompt-based flow consistent
 *     with `TextureUploadDialog`)
 */

import type { LayeredChannelName } from '../viewport/LayeredMaterialBinding';
import type { TextureInfo } from '../materials/MaterialLibrary';
import { Toast } from './Toast';

const CHANNEL_LABELS: Record<LayeredChannelName, string> = {
  albedo: '베이스 컬러 (Albedo)',
  normal: '노멀맵 (Normal)',
  roughness: '러프니스맵 (Roughness)',
  metallic: '메탈릭맵 (Metallic)',
};

export interface LayeredChannelUploadResult {
  channel: LayeredChannelName;
  info: TextureInfo;
}

/**
 * Open the upload flow for ONE channel. Returns the populated
 * `TextureInfo` or `null` if the user cancelled any step.
 *
 * Flow mirrors `TextureUploadDialog`:
 *   1. file pick (PNG/JPEG/WebP)
 *   2. projection prompt (planar/box/cylindrical)
 *   3. scale prompt
 *   4. label = filename
 */
export async function openLayeredChannelDialog(
  channel: LayeredChannelName,
): Promise<LayeredChannelUploadResult | null> {
  const label = CHANNEL_LABELS[channel];
  const file = await pickImageFile();
  if (!file) return null;

  const dataUrl = await fileToDataUrl(file);
  const projection = parseProjectionInput(
    window.prompt(
      `${label}\n\nUV 투영 방식\n` +
      '  1 = planar (평면 — 바닥/벽)\n' +
      '  2 = box (박스 — 큐브 자동)\n' +
      '  3 = cylindrical (원통 — 실린더)',
      '1',
    ),
  );
  if (projection === null) return null;

  const scale = parseScaleInput(
    window.prompt(
      `${label}\n\n타일 크기 (월드 단위 당 반복 횟수)\n` +
      '  0.001 = 1m 타일\n' +
      '  0.01  = 100mm 타일 (작은 패턴)',
      '0.001',
    ),
  );
  if (scale === null) {
    Toast.warning('유효한 scale 값을 입력해주세요.');
    return null;
  }

  return {
    channel,
    info: {
      dataUrl,
      projection,
      scale,
      rotation: 0,
      label: file.name,
    },
  };
}

/**
 * Parse projection prompt response. Pure helper — testable.
 * - `null` (cancel) → null
 * - '1' → 'planar', '2' → 'box', '3' → 'cylindrical'
 * - anything else → 'planar' (default fallback, mirrors existing dialog)
 */
export function parseProjectionInput(
  raw: string | null,
): 'planar' | 'box' | 'cylindrical' | null {
  if (raw === null) return null;
  switch (raw.trim()) {
    case '2': return 'box';
    case '3': return 'cylindrical';
    default: return 'planar';
  }
}

/**
 * Parse scale prompt response. Pure helper — testable.
 * - `null` (cancel) → null
 * - non-finite / ≤ 0 → null (caller shows error)
 * - finite positive → number
 */
export function parseScaleInput(raw: string | null): number | null {
  if (raw === null) return null;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

// ─── helpers (duplicated from TextureUploadDialog for module independence) ──

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/webp';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => { input.remove(); };

    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });
    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.click();
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
