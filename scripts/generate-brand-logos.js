const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function generateLogos() {
  const dprdPath = path.join(__dirname, '../public/logo-dprd.png');
  const kemendikdasmenPath = path.join(__dirname, '../public/logo-kemendikdasmen.png');

  // Resize logos
  const dprdBuffer = await sharp(dprdPath).resize({ height: 90 }).toBuffer();
  const kemenBuffer = await sharp(kemendikdasmenPath).resize({ height: 90 }).toBuffer();

  const textSvg = Buffer.from(`
    <svg width="340" height="90">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2563eb" />
          <stop offset="50%" stop-color="#4f46e5" />
          <stop offset="100%" stop-color="#9333ea" />
        </linearGradient>
      </defs>
      <text x="10" y="62" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="52" fill="url(#grad)">Kelas KA</text>
    </svg>
  `);

  // Composite horizontal logo
  await sharp({
    create: {
      width: 580,
      height: 110,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([
    { input: kemenBuffer, top: 10, left: 10 },
    { input: dprdBuffer, top: 10, left: 115 },
    { input: textSvg, top: 10, left: 230 }
  ])
  .png()
  .toFile(path.join(__dirname, '../public/logo-horizontal.png'));

  // Also copy to assets/logo-horizontal.png
  fs.copyFileSync(
    path.join(__dirname, '../public/logo-horizontal.png'),
    path.join(__dirname, '../assets/logo-horizontal.png')
  );

  // Composite mark (square icon)
  const dprdMark = await sharp(dprdPath).resize({ height: 60 }).toBuffer();
  const kemenMark = await sharp(kemendikdasmenPath).resize({ height: 60 }).toBuffer();

  await sharp({
    create: {
      width: 140,
      height: 70,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([
    { input: kemenMark, top: 5, left: 5 },
    { input: dprdMark, top: 5, left: 70 }
  ])
  .png()
  .toFile(path.join(__dirname, '../public/openmaic-mark.png'));

  console.log('Successfully generated brand logo assets!');
}

generateLogos().catch(console.error);
