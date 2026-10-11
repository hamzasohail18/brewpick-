// Text extraction for published menu files. PDFs: the text layer (exact, no OCR needed). Images:
// Tesseract with the English model shipped in node_modules (@tesseract.js-data/eng), so nothing is
// downloaded at run time. A scanned PDF (no text layer) is reported, not guessed.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface ExtractedText {
  method: "pdf-text" | "ocr";
  text: string;
  /** Tesseract's mean word confidence (0-100); null for a PDF text layer. */
  confidence: number | null;
}

export type FileKind = "pdf" | "image";

export class NoTextLayerError extends Error {
  constructor() {
    super("This PDF has no text layer (it's a scan). Publish the pages as images for OCR, or enter the menu by hand.");
    this.name = "NoTextLayerError";
  }
}

export function fileKind(contentType: string | null, url: string): FileKind | null {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf") || /\.pdf($|\?)/i.test(url)) return "pdf";
  if (/image\/(png|jpe?g|webp|gif|bmp|tiff)/.test(ct) || /\.(png|jpe?g|webp|gif|bmp|tiff?)($|\?)/i.test(url)) return "image";
  return null;
}

export async function pdfText(bytes: Uint8Array): Promise<ExtractedText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  if (text.replace(/\s/g, "").length < 20) throw new NoTextLayerError();
  return { method: "pdf-text", text, confidence: null };
}

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<{ text: string; confidence: number }>;
}

/** Tesseract, English, local model. One worker per run; call terminate() when done. */
export async function tesseractEngine(): Promise<OcrEngine & { terminate(): Promise<void> }> {
  const { createWorker } = await import("tesseract.js");
  // Resolved from the project root: works under tsx (CommonJS) and in the Next.js server bundle alike.
  const require = createRequire(join(process.cwd(), "package.json"));
  const langPath = join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
  const worker = await createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" });
  // Keep the gaps between the name and price columns as spaces.
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return {
    async recognize(image) {
      const { data } = await worker.recognize(Buffer.from(image));
      return { text: data.text, confidence: data.confidence };
    },
    terminate: () => worker.terminate().then(() => undefined),
  };
}

export async function extractMenuText(kind: FileKind, bytes: Uint8Array, engine?: OcrEngine): Promise<ExtractedText> {
  if (kind === "pdf") return pdfText(bytes);
  const own = engine ? null : await tesseractEngine();
  try {
    const { text, confidence } = await (engine ?? own!).recognize(bytes);
    return { method: "ocr", text, confidence };
  } finally {
    await own?.terminate();
  }
}
