import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PdfMeta {
  title?: string;
  level?: string;
  date?: string;
}

export async function downloadTextAsPdf(
  text: string,
  filename: string,
  meta: PdfMeta = {},
): Promise<void> {
  const content = text?.trim();
  if (!content) {
    throw new Error('Нет текста для экспорта в PDF');
  }

  const title = meta.title ?? 'MedLens — адаптированный текст';
  const date = meta.date ?? new Date().toLocaleDateString('ru-RU');
  const level = meta.level ?? '';

  const container = document.createElement('div');
  container.setAttribute('data-pdf-root', 'true');
  container.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:800px',
    'padding:48px',
    'background:#ffffff',
    'color:#1a1a1a',
    'font-family:Arial,Helvetica,sans-serif',
    'font-size:16px',
    'line-height:1.6',
    'box-sizing:border-box',
    'z-index:2147483647',
  ].join(';');

  container.innerHTML = `
    <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;color:#33272a;">${escapeHtml(title)}</h1>
    <p style="font-size:13px;color:#666;margin:0 0 24px;">
      ${level ? `Уровень: ${escapeHtml(level)} | ` : ''}Дата: ${escapeHtml(date)}
    </p>
    <div class="pdf-body" style="white-space:pre-wrap;word-wrap:break-word;font-size:15px;">${escapeHtml(content)}</div>
  `;

  document.body.appendChild(container);

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      width: container.scrollWidth,
      height: container.scrollHeight,
      windowWidth: container.scrollWidth,
      windowHeight: container.scrollHeight,
    });

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error('Не удалось сформировать PDF');
    }

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;

    const imgWidth = printableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < imgHeight - 0.5) {
      if (pageIndex > 0) doc.addPage();

      const sourceY = (offsetY / imgHeight) * canvas.height;
      const sliceHeightPx = Math.min(
        (printableHeight / imgHeight) * canvas.height,
        canvas.height - sourceY,
      );

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = Math.max(1, Math.ceil(sliceHeightPx));

      const ctx = pageCanvas.getContext('2d');
      if (!ctx) throw new Error('Не удалось сформировать PDF');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx,
      );

      const sliceHeightMm = (pageCanvas.height / canvas.width) * imgWidth;
      doc.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        margin,
        margin,
        imgWidth,
        sliceHeightMm,
      );

      offsetY += printableHeight;
      pageIndex++;
    }

    doc.save(filename);
  } finally {
    container.remove();
  }
}
