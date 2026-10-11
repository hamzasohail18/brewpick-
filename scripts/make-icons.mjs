// Regenerates the app icons from the SVG below (roasted-bean tile, cream cup):
//   node scripts/make-icons.mjs
// Writes public/icons/*.png (manifest), src/app/icon.svg, src/app/apple-icon.png and src/app/favicon.ico.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const BEAN = "#6f3f22";
const CREAM = "#fdf9f4";

// The cup, drawn on a 512 grid and centred on (256, 270).
const cup = `
  <g fill="none" stroke="${CREAM}" stroke-linecap="round" stroke-width="20">
    <path d="M206 186c-18-22 18-40 0-64"/><path d="M256 186c-18-22 18-40 0-64"/><path d="M306 186c-18-22 18-40 0-64"/>
    <path d="M352 252h16a44 44 0 0 1 0 88h-30" stroke-width="26"/>
  </g>
  <path d="M146 226h214v74a107 107 0 0 1-107 107h0a107 107 0 0 1-107-107z" fill="${CREAM}"/>
  <rect x="116" y="410" width="280" height="26" rx="13" fill="${CREAM}"/>`;

const svg = ({ rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${BEAN}"/>
  <g transform="translate(256 270) scale(${scale}) translate(-256 -270)">${cup}</g></svg>`;

const any = svg({ rounded: true, scale: 1 });
// Maskable: full-bleed background, artwork inside the central 80% safe zone.
const maskable = svg({ rounded: false, scale: 0.72 });
// Apple adds its own rounded corners.
const apple = svg({ rounded: false, scale: 0.86 });

const png = (s, size) => sharp(Buffer.from(s)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", await png(any, 192));
writeFileSync("public/icons/icon-512.png", await png(any, 512));
writeFileSync("public/icons/maskable-512.png", await png(maskable, 512));
writeFileSync("src/app/apple-icon.png", await png(apple, 180));
writeFileSync("src/app/icon.svg", any);

// favicon.ico holding one 32x32 PNG (ICO allows PNG payloads).
const fav = await png(any, 32);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // no palette
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(fav.length, 14);
header.writeUInt32LE(22, 18); // offset
writeFileSync("src/app/favicon.ico", Buffer.concat([header, fav]));
console.log("icons written");
