// Regenerates menu.png and menu.pdf (fictional menu) for the menu-file collector tests:
//   node tests/fixtures/menu-file/make-fixtures.mjs
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const dir = new URL(".", import.meta.url);
const LINES = [
  ["HOT COFFEE", ""],
  ["", "Small    Large"],
  ["Cappuccino", "450      550"],
  ["Cafe Latte", "480      590"],
  ["Americano 12 oz", "Rs. 400/-"],
  ["Espresso  Single 300  Double 450", ""],
  ["COLD", ""],
  ["Iced Mocha", "620      740"],
];

const rows = LINES.map(([left, right], i) => {
  const y = 70 + i * 52;
  return `<text x="40" y="${y}">${left}</text><text x="470" y="${y}">${right}</text>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520">
  <rect width="100%" height="100%" fill="#fff"/>
  <g font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#111">${rows}</g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(new URL("menu.png", dir).pathname);

// Minimal one-page PDF with a real text layer (Helvetica), built by hand so no PDF library is needed.
const textOps = LINES.map(([l, r], i) => `BT /F1 14 Tf 50 ${760 - i * 24} Td (${`${l}  ${r}`.trim()}) Tj ET`).join("\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(textOps)} >>\nstream\n${textOps}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(new URL("menu.pdf", dir), pdf);
console.log("wrote menu.png and menu.pdf");
