import fs from 'fs';

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${src} to ${dest}`);
  }
}

// Clean up existing messy directories first
if (fs.existsSync('.next/standalone/.next/static')) {
  fs.rmSync('.next/standalone/.next/static', { recursive: true, force: true });
}
if (fs.existsSync('.next/standalone/public')) {
  fs.rmSync('.next/standalone/public', { recursive: true, force: true });
}

// Ensure clean copy
copyDir('.next/static', '.next/standalone/.next/static');
copyDir('public', '.next/standalone/public');
