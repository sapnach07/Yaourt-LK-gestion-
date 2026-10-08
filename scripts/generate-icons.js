import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Create public/icon.svg
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f766e" />
      <stop offset="100%" stop-color="#0d9488" />
    </linearGradient>
    <linearGradient id="creamGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f1f5f9" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#042f2e" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Background rounded rectangle -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)" />

  <!-- Yogurt bottle / jar silhouette -->
  <g filter="url(#shadow)" transform="translate(0, 0)">
    <!-- Lid / Cap -->
    <rect x="206" y="90" width="100" height="28" rx="10" fill="#ffffff" />
    <rect x="226" y="118" width="60" height="22" rx="4" fill="#e2e8f0" />
    
    <!-- Bottle body -->
    <path d="M 216 140 
             C 170 180, 148 220, 148 290 
             C 148 375, 185 410, 256 410 
             C 327 410, 364 375, 364 290 
             C 364 220, 342 180, 296 140 
             Z" 
          fill="url(#creamGrad)" />

    <!-- Wave / Cream swirl line -->
    <path d="M 170 290 
             Q 213 320, 256 290 
             T 342 290 
             L 342 340 
             C 336 385, 305 400, 256 400 
             C 207 400, 176 385, 170 340 
             Z" 
          fill="#14b8a6" 
          opacity="0.25" />

    <!-- Stylized "Y" Letter in Center -->
    <path d="M 226 215 L 244 255 L 244 315 L 268 315 L 268 255 L 286 215 L 262 215 L 256 235 L 250 215 Z" 
          fill="#0f766e" />
  </g>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');

// Function to draw pixel-based PNG icon
function generatePngIcon(size, isMaskable = false) {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const radius = isMaskable ? size * 0.45 : size * 0.44;
  const cornerRadius = isMaskable ? 0 : size * 0.22; // rounded squircle for standard, full bleed for maskable

  // Colors
  const bgR1 = 15, bgG1 = 118, bgB1 = 110; // #0f766e
  const bgR2 = 13, bgG2 = 148, bgB2 = 136; // #0d9488
  const creamR = 255, creamG = 255, creamB = 255;
  const brandDarkR = 15, brandDarkG = 118, brandDarkB = 110;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const t = (x + y) / (size * 2);
      const bgR = Math.round(bgR1 + (bgR2 - bgR1) * t);
      const bgG = Math.round(bgG1 + (bgG2 - bgG1) * t);
      const bgB = Math.round(bgB1 + (bgB2 - bgB1) * t);

      let inOuter = true;
      if (!isMaskable) {
        // Squircle mask (rounded rect)
        const dx = Math.max(Math.abs(x - center) - (center - cornerRadius), 0);
        const dy = Math.max(Math.abs(y - center) - (center - cornerRadius), 0);
        inOuter = (dx * dx + dy * dy) <= (cornerRadius * cornerRadius);
      }

      if (!inOuter) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Default background color
      let r = bgR;
      let g = bgG;
      let b = bgB;
      let a = 255;

      // Coordinate relative to center normalized [-1, 1]
      const scale = isMaskable ? 0.72 : 0.85; // safe zone padding
      const nx = (x - center) / (center * scale);
      const ny = (y - center) / (center * scale);

      // Check Bottle Body:
      // Cap: ny between -0.65 and -0.54, nx between -0.22 and 0.22
      const inCap = ny >= -0.65 && ny <= -0.54 && Math.abs(nx) <= 0.22;
      const inNeck = ny > -0.54 && ny <= -0.45 && Math.abs(nx) <= 0.14;

      // Bottle main body: ny between -0.45 and 0.65
      // width expands from 0.16 at -0.45 to 0.46 at 0.1, then rounds down at 0.65
      let inBody = false;
      if (ny > -0.45 && ny <= 0.65) {
        const progress = (ny + 0.45) / 1.1; // 0 to 1
        let maxHalfW = 0.48;
        if (progress < 0.3) {
          maxHalfW = 0.16 + (0.48 - 0.16) * (progress / 0.3);
        } else if (progress > 0.85) {
          const bottomP = (progress - 0.85) / 0.15;
          maxHalfW = 0.48 * Math.sqrt(Math.max(0, 1 - bottomP * bottomP));
        }
        if (Math.abs(nx) <= maxHalfW) {
          inBody = true;
        }
      }

      if (inCap || inNeck || inBody) {
        r = creamR;
        g = creamG;
        b = creamB;

        // Wave decoration in bottom half
        if (inBody && ny > 0.05 && ny < 0.62) {
          const wave = 0.06 * Math.sin(nx * 10);
          if (ny > 0.15 + wave) {
            // soft teal milk tint
            r = 204;
            g = 251;
            b = 241;
          }
        }

        // Draw letter "Y" inside the bottle
        // Upper arms: from (-0.12, -0.18) to (0, 0), and (0.12, -0.18) to (0, 0)
        // Lower stem: from (0, 0) to (0, 0.28)
        const stemW = 0.045;
        const inStem = Math.abs(nx) <= stemW && ny >= 0.0 && ny <= 0.26;
        let inArms = false;
        if (ny >= -0.20 && ny < 0.05) {
          const targetX = Math.abs(nx);
          const expectedX = -ny * 0.8;
          if (Math.abs(targetX - expectedX) <= stemW * 1.1) {
            inArms = true;
          }
        }

        if (inStem || inArms) {
          r = brandDarkR;
          g = brandDarkG;
          b = brandDarkB;
        }
      }

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }

  return PNG.sync.write(png);
}

// Generate PNG files
console.log('Generating PNG icons...');
const icon192 = generatePngIcon(192, false);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);

const icon512 = generatePngIcon(512, false);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);

const iconMaskable512 = generatePngIcon(512, true);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), iconMaskable512);

const iconApple = generatePngIcon(180, false);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), iconApple);

// Favicon copy
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), generatePngIcon(64, false));

console.log('Successfully generated all PWA icons in /public!');
