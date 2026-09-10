import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_LOGO = 'E:/桌面/图片素材/logo.png';
const FALLBACK_LOGO = 'C:/Users/Senor/.gemini/antigravity/brain/18eae520-d263-4ed0-a549-4a66a4df0e13/.user_uploaded/media_1789035889351.jpg';
const OUT_DIR = 'src-tauri/icons';

export async function generateRoundedLogo(size = 1024, radiusRatio = 0.25) {
  let sourceToUse = SOURCE_LOGO;
  if (!fs.existsSync(SOURCE_LOGO)) {
    if (fs.existsSync(FALLBACK_LOGO)) {
      sourceToUse = FALLBACK_LOGO;
    } else {
      throw new Error(`Logo not found at ${SOURCE_LOGO} or ${FALLBACK_LOGO}`);
    }
  }

  const radius = Math.round(size * radiusRatio);
  console.log(`[Logo] Processing ${sourceToUse} to size=${size}x${size}, radius=${radius} (${radiusRatio * 100}%)`);

  const maskSvg = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>
  `);

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const masterLogoPath = path.join(OUT_DIR, 'icon.png');
  const previewPath = 'C:/Users/Senor/.gemini/antigravity/brain/18eae520-d263-4ed0-a549-4a66a4df0e13/rounded_logo_preview.png';

  await sharp(sourceToUse)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .composite([{
      input: maskSvg,
      blend: 'dest-in'
    }])
    .png()
    .toFile(masterLogoPath);

  // Also save preview to artifact folder
  try {
    fs.copyFileSync(masterLogoPath, previewPath);
    console.log(`[Logo] Saved preview to ${previewPath}`);
  } catch (e) {
    console.warn('[Logo] Warning saving preview:', e.message);
  }

  console.log(`[Logo] Saved master icon to ${masterLogoPath}`);
  return masterLogoPath;
}

generateRoundedLogo().catch(err => {
  console.error('[Logo] Error:', err);
  process.exit(1);
});
