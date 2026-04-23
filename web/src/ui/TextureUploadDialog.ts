/**
 * TextureUploadDialog — 이미지 파일을 업로드하여 texture가 적용된 재질 생성.
 *
 * Flow:
 *   1. 사용자가 메뉴 / 우클릭으로 호출
 *   2. 파일 선택 다이얼로그 → PNG/JPEG 이미지 로드
 *   3. FileReader → base64 data URL 변환
 *   4. projection (planar/box/cylindrical) + scale 선택
 *   5. "새 재질" 이름 입력
 *   6. MaterialLibrary.addCustom() 호출 + 즉시 할당
 *
 * 저장:
 *   · TextureInfo.dataUrl은 .xia 파일에 그대로 포함 (base64)
 *   · 이미지 크기가 큰 경우 파일 크기 주의 — 1024×1024 PNG ≈ 1-3MB
 */

import { getMaterialLibrary, type Material } from '../materials/MaterialLibrary';
import { Toast } from './Toast';

export interface TextureUploadResult {
  material: Material;
  appliedToFaces: number[];  // 할당된 face IDs
}

export async function openTextureUploadDialog(
  selectedFaceIds: number[],
): Promise<TextureUploadResult | null> {
  // Step 1 — 파일 선택.
  const file = await pickImageFile();
  if (!file) return null;

  // Step 2 — data URL 변환.
  const dataUrl = await fileToDataUrl(file);

  // Step 3 — 설정 입력.
  const projection = prompt(
    'UV 투영 방식\n' +
    '  1 = planar (평면 — 바닥/벽)\n' +
    '  2 = box (박스 — 큐브 자동)\n' +
    '  3 = cylindrical (원통 — 실린더)',
    '1',
  );
  if (projection === null) return null;
  const projectionMode: 'planar' | 'box' | 'cylindrical' =
    projection === '2' ? 'box' :
    projection === '3' ? 'cylindrical' : 'planar';

  const scaleStr = prompt(
    '타일 크기 (mm 당 반복 횟수, 기본 0.001 = 1m당 1타일)\n' +
    '  0.001 = 1m 타일\n' +
    '  0.01  = 100mm 타일 (작은 패턴)',
    '0.001',
  );
  if (scaleStr === null) return null;
  const scale = parseFloat(scaleStr);
  if (!Number.isFinite(scale) || scale <= 0) {
    alert('유효한 scale 값을 입력해주세요.');
    return null;
  }

  const name = prompt('새 재질 이름', file.name.replace(/\.(png|jpe?g|webp)$/i, ''));
  if (!name) return null;

  // Step 4 — Material 생성.
  const lib = getMaterialLibrary();
  const material = lib.addCustom({
    id: `custom-${Date.now().toString(36)}`,
    rustId: 0,  // lib 내부에서 rustId 할당; addCustom 구현에서 처리
    name,
    nameEn: name,
    category: 'custom',
    physical: {
      density: 1000,
      friction: 0.5,
      restitution: 0.3,
      specificGravity: 1.0,
      thermalConductivity: 0.5,
      fireRating: 'retardant',
    },
    visual: {
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.0,
      opacity: 1.0,
      texture: {
        dataUrl,
        projection: projectionMode,
        scale,
        rotation: 0,
        label: file.name,
      },
    },
  });

  // Step 5 — 선택된 face에 할당.
  if (selectedFaceIds.length > 0) {
    lib.assignToFaces(selectedFaceIds, material.id);
    Toast.info(`재질 "${name}" 생성 + ${selectedFaceIds.length}개 면에 적용`, 3000);
  } else {
    Toast.info(`재질 "${name}" 생성됨. 면 선택 후 Inspector에서 할당하세요.`, 3500);
  }

  return { material, appliedToFaces: [...selectedFaceIds] };
}

// ─── helpers ──────────────────────────────────────────────────────

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
    // 사용자가 취소하면 change 이벤트 자체가 발생 안 함 → timeout 우회
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
