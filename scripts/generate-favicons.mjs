import path from 'node:path';
import sharp from 'sharp';

async function generateFavicons() {
  const dprdPath = path.join(process.cwd(), 'public', 'logo-dprd.png');

  // Resize DPRD logo to fill max 256x256 canvas with fit contain
  const dprdBuf = await sharp(dprdPath)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const icon256 = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: dprdBuf, top: 0, left: 0 }])
    .png()
    .toBuffer();

  // Save app/apple-icon.png (180x180)
  await sharp(icon256)
    .resize(180, 180)
    .png()
    .toFile(path.join(process.cwd(), 'app', 'apple-icon.png'));

  // Save app/favicon.ico (64x64 PNG saved as favicon.ico)
  await sharp(icon256)
    .resize(64, 64)
    .png()
    .toFile(path.join(process.cwd(), 'app', 'favicon.ico'));

  // Save public/favicon.ico
  await sharp(icon256)
    .resize(64, 64)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'favicon.ico'));

  // Save public/favicon.png
  await sharp(icon256)
    .resize(64, 64)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'favicon.png'));

  console.log('Successfully generated maximum-sized DPRD tab favicons!');
}

generateFavicons().catch((error) => {
  console.error(error);
  process.exit(1);
});
