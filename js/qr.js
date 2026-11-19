// QR code rendering for SMART Health Links (error correction level M, as the spec recommends).
import qrcode from '../vendor/qrcode-generator.mjs';

export function renderQR(text, { scale = 8, margin = 4 } = {}) {
  const qr = qrcode(0, 'M'); // 0 = choose the smallest version that fits
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
  canvas.setAttribute('role', 'img');
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
