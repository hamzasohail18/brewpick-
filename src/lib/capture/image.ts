// Shrinks a camera photo to a readable menu image before it leaves the phone. Re-encoding through a
// canvas also drops EXIF (GPS position, device), and saves mobile data in the shop.

export async function compressPhoto(file: Blob, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the photo"))), "image/jpeg", quality),
  );
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      // Applies the EXIF rotation so portrait photos stay upright after the metadata is dropped.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through (older Safari, unusual formats)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
