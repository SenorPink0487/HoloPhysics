import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('public/assets/portraits');
const files = (await fs.readdir(root)).filter((file) => /\.jpe?g$/i.test(file));
for (const file of files) {
  const input = path.join(root, file);
  const output = path.join(root, file.replace(/\.jpe?g$/i, '.webp'));
  await sharp(input)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output);
  console.log(`${file} -> ${path.basename(output)}`);
}
