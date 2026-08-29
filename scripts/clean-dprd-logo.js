const sharp = require('sharp');
const path = require('path');

async function makeTransparent() {
  const inputPath = path.join(__dirname, '../public/logo-dprd.png');
  const image = sharp(inputPath);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // Make white/near-white pixels transparent (r>240, g>240, b>240)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) {
      data[i + 3] = 0; // Set alpha to 0
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .trim()
    .png()
    .toFile(path.join(__dirname, '../public/logo-dprd-clean.png'));

  console.log('Processed transparent logo successfully!');
}

makeTransparent().catch(console.error);
