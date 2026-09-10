import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_IMAGE = 'E:/桌面/图片素材/背景1.png';
const FALLBACK_SOURCE = 'src-tauri/nsis/background.png';
const LOGO_SOURCE = 'src-tauri/icons/icon.png';
const RAW_LOGO_SOURCE = 'E:/桌面/图片素材/logo.png';
const OUT_DIR = 'src-tauri/nsis';

export async function prepareAssets(width = 768, height = 512) {
  let sourceToUse = SOURCE_IMAGE;
  if (!fs.existsSync(SOURCE_IMAGE)) {
    if (fs.existsSync(FALLBACK_SOURCE)) {
      sourceToUse = FALLBACK_SOURCE;
    } else {
      throw new Error(`Source image not found: ${SOURCE_IMAGE} and fallback ${FALLBACK_SOURCE}`);
    }
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const outBmp = path.join(OUT_DIR, 'background.bmp');
  const outPng = path.join(OUT_DIR, 'background.png');

  // 1. Resize base background to target 768x512
  const baseBgBuffer = await sharp(sourceToUse)
    .resize(width, height)
    .toBuffer();

  // 2. Obtain rounded logo
  let logoBuffer = null;
  if (fs.existsSync(LOGO_SOURCE)) {
    logoBuffer = fs.readFileSync(LOGO_SOURCE);
  } else if (fs.existsSync(RAW_LOGO_SOURCE)) {
    const rawLogo = fs.readFileSync(RAW_LOGO_SOURCE);
    const radius = Math.round(512 * 0.25);
    const maskSvg = Buffer.from(`
      <svg width="512" height="512" viewBox="0 0 512 512">
        <rect x="0" y="0" width="512" height="512" rx="${radius}" ry="${radius}" fill="#fff"/>
      </svg>
    `);
    logoBuffer = await sharp(rawLogo)
      .resize(512, 512, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: maskSvg, blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  let finalPngBuffer;
  if (logoBuffer) {
    // Cover the template interlocking circles (x: 674..703, y: 457..476 in 768x512)
    const patch = await sharp({
      create: {
        width: 70,
        height: 35,
        channels: 3,
        background: { r: 246, g: 247, b: 247 }
      }
    }).png().toBuffer();

    const logoSize = 32;
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoSize, logoSize)
      .toBuffer();

    // Composite patch and logo in place of the old circles
    // Aligned to text left margin x=675, y=456
    finalPngBuffer = await sharp(baseBgBuffer)
      .composite([
        { input: patch, left: 670, top: 455 },
        { input: resizedLogo, left: 675, top: 456 }
      ])
      .png()
      .toBuffer();

    console.log(`[Installer Assets] Embedded custom 25% rounded logo (${logoSize}x${logoSize}) at (675, 456) replacing placeholder logo`);
  } else {
    finalPngBuffer = baseBgBuffer;
  }

  // Save background.png
  fs.writeFileSync(outPng, finalPngBuffer);

  // Copy preview to artifact folder
  const previewPath = 'C:/Users/Senor/.gemini/antigravity/brain/18eae520-d263-4ed0-a549-4a66a4df0e13/installer_background_with_logo.png';
  try {
    fs.writeFileSync(previewPath, finalPngBuffer);
  } catch (e) {
    // ignore
  }

  // 3. Generate uncompressed 24-bit BMP for NSIS
  const { data } = await sharp(finalPngBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const destOffset = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const srcOffset = (srcY * width + x) * 3;
      buf[destOffset + x * 3] = data[srcOffset + 2];
      buf[destOffset + x * 3 + 1] = data[srcOffset + 1];
      buf[destOffset + x * 3 + 2] = data[srcOffset];
    }
  }

  fs.writeFileSync(outBmp, buf);
  console.log(`[Installer Assets] Successfully generated: ${outBmp} (${width}x${height}, ${fileSize} bytes)`);
}

prepareAssets().catch((err) => {
  console.error('[Installer Assets] Error:', err);
  process.exit(1);
});
