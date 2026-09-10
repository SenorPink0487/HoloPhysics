import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_IMAGE = 'E:/桌面/图片素材/背景1.png';
const OUT_DIR = 'src-tauri/nsis';

export async function prepareAssets(width = 768, height = 512) {
  if (!fs.existsSync(SOURCE_IMAGE)) {
    throw new Error(`Source image not found: ${SOURCE_IMAGE}`);
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const outBmp = path.join(OUT_DIR, 'background.bmp');
  const outPng = path.join(OUT_DIR, 'background.png');

  fs.copyFileSync(SOURCE_IMAGE, outPng);

  const { data } = await sharp(SOURCE_IMAGE)
    .resize(width, height)
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
