import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Maintain public/icon.svg (the official vector logo)
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Fond carré 512x512 #0d9488 -->
  <rect width="512" height="512" fill="#0d9488" rx="96" />

  <!-- Pot de yaourt blanc simple -->
  <g fill="#ffffff">
    <!-- Couvercle / Opercule supérieur -->
    <rect x="176" y="112" width="160" height="24" rx="8" />
    
    <!-- Col / Rebord sous le couvercle -->
    <path d="M 188 136 L 324 136 L 316 160 L 196 160 Z" />

    <!-- Corps du pot de yaourt -->
    <path d="M 192 160 
             L 320 160 
             L 300 380 
             C 298 396, 284 408, 268 408 
             L 244 408 
             C 228 408, 214 396, 212 380 
             Z" />

    <!-- Cuillère minimaliste intégrée sur le côté -->
    <path d="M 336 128 
             C 346 112, 366 112, 376 128 
             C 386 144, 376 168, 360 178 
             L 336 290 
             L 326 288 
             L 348 174 
             C 342 166, 338 152, 336 128 
             Z" />
  </g>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Exact point-in-shape tester on 512x512 canvas
function isInsideYogurt(x, y) {
  // 1. Lid: rect x=176..336, y=112..136, rx=8
  if (x >= 176 && x <= 336 && y >= 112 && y <= 136) {
    const dx = Math.max(0, Math.abs(x - 256) - 72);
    const dy = Math.max(0, Math.abs(y - 124) - 4);
    if (dx * dx + dy * dy <= 64) return true;
  }
  // 2. Neck: y 136..160
  if (y >= 136 && y <= 160) {
    const t = (y - 136) / 24;
    const halfW = 68 - 8 * t;
    if (Math.abs(x - 256) <= halfW) return true;
  }
  // 3. Pot body: y 160..380
  if (y > 160 && y <= 380) {
    const t = (y - 160) / 220;
    const halfW = 64 - 20 * t;
    if (Math.abs(x - 256) <= halfW) return true;
  }
  // Bottom rounded base: y 380..408
  if (y > 380 && y <= 408) {
    if (Math.abs(x - 256) <= 12) return true;
    if (x < 244) {
      const dx = (244 - x) / 32;
      const dy = (y - 380) / 28;
      if (dx * dx + dy * dy <= 1) return true;
    } else if (x > 268) {
      const dx = (x - 268) / 32;
      const dy = (y - 380) / 28;
      if (dx * dx + dy * dy <= 1) return true;
    }
  }
  // 4. Spoon head: ellipse around (358, 142)
  const rad = -15 * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const rx = cosA * (x - 358) - sinA * (y - 142);
  const ry = sinA * (x - 358) + cosA * (y - 142);
  if ((rx / 17.5) ** 2 + (ry / 23.5) ** 2 <= 1) return true;

  // Spoon handle: line from (354, 162) to (331, 289), radius ~ 5.2
  if (distToSegment(x, y, 354, 162, 331, 289) <= 5.2) return true;

  return false;
}

// Generate PNG with 4x supersampling anti-aliasing
function generatePngIcon(size, isMaskable = false, roundCorners = true) {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const cornerRadius = (isMaskable || !roundCorners) ? 0 : size * 0.22;

  // Colors: Teal #0d9488 and White #ffffff
  const bgR = 13, bgG = 148, bgB = 136;
  const fgR = 255, fgG = 255, fgB = 255;

  // Scale factor from 512x512 canvas
  const contentScale = isMaskable ? 0.82 : 0.92;
  const scale = (size / 512) * contentScale;
  const offsetX = (size - 512 * scale) / 2;
  const offsetY = (size - 512 * scale) / 2;

  // 4x4 supersampling offsets
  const samples = [
    [-0.375, -0.375], [-0.125, -0.375], [0.125, -0.375], [0.375, -0.375],
    [-0.375, -0.125], [-0.125, -0.125], [0.125, -0.125], [0.375, -0.125],
    [-0.375,  0.125], [-0.125,  0.125], [0.125,  0.125], [0.375,  0.125],
    [-0.375,  0.375], [-0.125,  0.375], [0.125,  0.375], [0.375,  0.375],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Outer squircle test
      let outerSampleCount = 0;
      let shapeSampleCount = 0;

      for (const [ox, oy] of samples) {
        const sx = x + ox;
        const sy = y + oy;

        let inOuter = true;
        if (cornerRadius > 0) {
          const cdx = Math.max(Math.abs(sx - center) - (center - cornerRadius), 0);
          const cdy = Math.max(Math.abs(sy - center) - (center - cornerRadius), 0);
          inOuter = (cdx * cdx + cdy * cdy) <= (cornerRadius * cornerRadius);
        }

        if (inOuter) {
          outerSampleCount++;
          // Map to 512 coordinate space
          const canvasX = (sx - offsetX) / scale;
          const canvasY = (sy - offsetY) / scale;
          if (isInsideYogurt(canvasX, canvasY)) {
            shapeSampleCount++;
          }
        }
      }

      if (outerSampleCount === 0) {
        // Transparent outside squircle
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      const outerAlpha = outerSampleCount / 16;
      const shapeCoverage = shapeSampleCount / outerSampleCount; // 0 (all teal) to 1 (all white)

      const r = Math.round(bgR + (fgR - bgR) * shapeCoverage);
      const g = Math.round(bgG + (fgG - bgG) * shapeCoverage);
      const b = Math.round(bgB + (fgB - bgB) * shapeCoverage);
      const a = Math.round(255 * outerAlpha);

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }

  return PNG.sync.write(png);
}

console.log('Generating pixel-perfect PNG icons for PWA & APK...');

const icon192 = generatePngIcon(192, false, true);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);

const icon512 = generatePngIcon(512, false, true);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);

// Maskable icon has full bleed background (no outer transparent corners) as required by Android APK
const iconMaskable512 = generatePngIcon(512, true, false);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), iconMaskable512);

const iconApple = generatePngIcon(180, false, true);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), iconApple);

const iconFavicon = generatePngIcon(64, false, false);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), iconFavicon);

console.log('All icons generated successfully with official yogurt logo!');
