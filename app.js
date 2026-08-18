/* Almate.edu.lk PDF Footer Tool
 * Static GitHub Pages app. All PDF processing happens locally in the browser.
 */

(() => {
  'use strict';

  const { PDFDocument } = PDFLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const CONFIG = {
    footerUrl: 'assets/footer.png',
    footerPixelWidth: 1800,
    footerPixelHeight: 140,
    footerWidthMm: 180,
    footerHeightMm: 14,
    bottomMarginMm: 1.5,
    analysisPaddingMm: 0.8,
    a4Ratio: 210 / 297,
    a4RatioTolerance: 0.035,
    renderTargetWidthPx: 1100,
    // Dark content threshold is adaptive; these values make skipping conservative.
    darknessDelta: 32,
    maxInkRatio: 0.0035,
    maxDarkSamples: 130,
    maxFileBytes: 100 * 1024 * 1024,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    year: $('year'), subject: $('subject'), language: $('language'),
    file: $('pdfFile'), drop: $('dropZone'), browse: $('browseBtn'),
    fileMeta: $('fileMeta'), filename: $('filenamePreview'),
    analyze: $('analyzeBtn'), process: $('processBtn'), clear: $('clearBtn'),
    empty: $('emptyResults'), progressWrap: $('progressWrap'), progressLabel: $('progressLabel'),
    progressPercent: $('progressPercent'), progressBar: $('progressBar'),
    summary: $('summary'), total: $('statTotal'), eligible: $('statEligible'),
    skipped: $('statSkipped'), size: $('statSize'), pageList: $('pageList'),
    downloadAgain: $('downloadAgain'), error: $('errorBox'),
  };

  let selectedFile = null;
  let sourceBytes = null;
  let analysis = null;
  let footerBytes = null;
  let outputUrl = null;
  let isBusy = false;

  const mmToPt = (mm) => mm * 72 / 25.4;
  const fmtBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
  };

  function cleanNamePart(value, fallback) {
    const v = String(value || '').trim() || fallback;
    return v
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || fallback;
  }

  function outputFilename() {
    return `${cleanNamePart(els.year.value, 'Year')}-${cleanNamePart(els.subject.value, 'Subject')}-${cleanNamePart(els.language.value, 'Language')}.pdf`;
  }

  function updateFilename() {
    els.filename.textContent = outputFilename();
    updateButtons();
  }

  function detailsReady() {
    return els.year.value.trim() && els.subject.value.trim() && els.language.value.trim();
  }

  function updateButtons() {
    const ready = !!selectedFile && !!detailsReady() && !isBusy;
    els.analyze.disabled = !ready;
    els.process.disabled = !ready;
  }

  function setBusy(busy) {
    isBusy = busy;
    updateButtons();
    els.clear.disabled = busy;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.classList.remove('hidden');
  }

  function clearError() {
    els.error.textContent = '';
    els.error.classList.add('hidden');
  }

  function setProgress(label, done, total) {
    els.progressWrap.classList.remove('hidden');
    els.progressLabel.textContent = label;
    const pct = total ? Math.round((done / total) * 100) : 0;
    els.progressPercent.textContent = `${pct}%`;
    els.progressBar.style.width = `${pct}%`;
  }

  function hideProgress() {
    els.progressWrap.classList.add('hidden');
  }

  async function fetchFooterBytes() {
    if (footerBytes) return footerBytes;
    const res = await fetch(CONFIG.footerUrl);
    if (!res.ok) throw new Error('Footer image could not be loaded.');
    footerBytes = new Uint8Array(await res.arrayBuffer());
    return footerBytes;
  }

  async function handleFile(file) {
    clearError();
    analysis = null;
    clearOutputUrl();
    renderAnalysis(null);

    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError('Please choose a PDF file.');
      return;
    }
    if (file.size > CONFIG.maxFileBytes) {
      showError(`This browser version accepts files up to ${fmtBytes(CONFIG.maxFileBytes)}. Your PDF is ${fmtBytes(file.size)}.`);
      return;
    }

    selectedFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    els.fileMeta.textContent = `${file.name} · ${fmtBytes(file.size)}`;
    els.fileMeta.classList.remove('hidden');
    updateButtons();
  }

  function isPortraitA4ish(widthPt, heightPt) {
    if (heightPt <= widthPt) return false;
    const ratio = widthPt / heightPt;
    return Math.abs(ratio - CONFIG.a4Ratio) <= CONFIG.a4RatioTolerance;
  }

  async function loadFooterImage() {
    const img = new Image();
    img.decoding = 'async';
    img.src = CONFIG.footerUrl;
    await img.decode();
    return img;
  }

  function median(values) {
    if (!values.length) return 255;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }

  function inspectRegion(pageImageData, canvasWidth, canvasHeight, rectPx, footerMaskData, maskWidth, maskHeight) {
    const data = pageImageData.data;
    const mask = footerMaskData.data;

    // Estimate background from the whole placement rectangle, sparsely sampled.
    const backgroundSamples = [];
    const x0 = Math.max(0, Math.floor(rectPx.x));
    const y0 = Math.max(0, Math.floor(rectPx.y));
    const x1 = Math.min(canvasWidth, Math.ceil(rectPx.x + rectPx.w));
    const y1 = Math.min(canvasHeight, Math.ceil(rectPx.y + rectPx.h));

    for (let y = y0; y < y1; y += 5) {
      for (let x = x0; x < x1; x += 5) {
        const i = (y * canvasWidth + x) * 4;
        backgroundSamples.push((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
      }
    }
    const bg = median(backgroundSamples);
    const darkThreshold = Math.max(95, bg - CONFIG.darknessDelta);

    let masked = 0;
    let dark = 0;
    const step = 2;

    for (let my = 0; my < maskHeight; my += step) {
      const py = y0 + my;
      if (py < 0 || py >= canvasHeight) continue;
      for (let mx = 0; mx < maskWidth; mx += step) {
        const maskIdx = (my * maskWidth + mx) * 4;
        if (mask[maskIdx + 3] < 42) continue;
        const px = x0 + mx;
        if (px < 0 || px >= canvasWidth) continue;

        masked++;
        const idx = (py * canvasWidth + px) * 4;
        const lum = (data[idx] * 0.299) + (data[idx + 1] * 0.587) + (data[idx + 2] * 0.114);
        if (lum < darkThreshold) dark++;
      }
    }

    const ratio = masked ? dark / masked : 1;
    const blank = ratio <= CONFIG.maxInkRatio && dark <= CONFIG.maxDarkSamples;
    return { blank, ratio, dark, background: bg };
  }

  async function analyzePdf() {
    if (!sourceBytes) throw new Error('Select a PDF first.');

    const pdfData = new Uint8Array(sourceBytes); // PDF.js may transfer/detach its input.
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    const footerImg = await loadFooterImage();
    const results = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      setProgress(`Checking page ${n} of ${pdf.numPages}…`, n - 1, pdf.numPages);
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const widthPt = base.width;
      const heightPt = base.height;

      if (!isPortraitA4ish(widthPt, heightPt)) {
        results.push({ page: n, eligible: false, reason: 'Skipped: page is not A4 portrait', widthPt, heightPt });
        page.cleanup();
        continue;
      }

      const scale = CONFIG.renderTargetWidthPx / widthPt;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const footerHpt = mmToPt(CONFIG.footerHeightMm);
      const footerWpt = mmToPt(CONFIG.footerWidthMm);
      const bottomPt = mmToPt(CONFIG.bottomMarginMm);
      const padPt = mmToPt(CONFIG.analysisPaddingMm);
      const actualWpt = Math.min(footerWpt, widthPt - mmToPt(10));
      const actualHpt = actualWpt / (CONFIG.footerPixelWidth / CONFIG.footerPixelHeight);
      const xPt = (widthPt - actualWpt) / 2;
      const yPt = bottomPt;

      const rectPt = {
        x: Math.max(0, xPt - padPt),
        y: Math.max(0, yPt - padPt),
        w: Math.min(widthPt, actualWpt + 2 * padPt),
        h: Math.min(heightPt, actualHpt + 2 * padPt),
      };

      const rectPx = {
        x: rectPt.x * scale,
        y: canvas.height - (rectPt.y + rectPt.h) * scale,
        w: rectPt.w * scale,
        h: rectPt.h * scale,
      };

      // Mask matches the real footer rectangle (plus transparent padding inside a placement canvas).
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = Math.max(1, Math.ceil(rectPx.w));
      maskCanvas.height = Math.max(1, Math.ceil(rectPx.h));
      const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
      const innerX = padPt * scale;
      const innerY = padPt * scale;
      mctx.drawImage(footerImg, innerX, innerY, actualWpt * scale, actualHpt * scale);
      const maskData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const pageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const inspected = inspectRegion(pageData, canvas.width, canvas.height, rectPx, maskData, maskCanvas.width, maskCanvas.height);

      results.push({
        page: n,
        eligible: inspected.blank,
        reason: inspected.blank ? 'Footer area is clear' : 'Skipped: content detected in footer area',
        widthPt, heightPt, xPt, yPt, wPt: actualWpt, hPt: actualHpt,
        inkRatio: inspected.ratio,
      });

      canvas.width = canvas.height = 1;
      maskCanvas.width = maskCanvas.height = 1;
      page.cleanup();
    }

    await loadingTask.destroy();
    setProgress('Analysis complete', pdf.numPages, pdf.numPages);
    return { pages: results, total: pdf.numPages };
  }

  function renderAnalysis(result) {
    if (!result) {
      els.empty.classList.remove('hidden');
      els.summary.classList.add('hidden');
      els.pageList.classList.add('hidden');
      els.pageList.innerHTML = '';
      return;
    }

    const ready = result.pages.filter(p => p.eligible).length;
    const skipped = result.total - ready;
    els.empty.classList.add('hidden');
    els.summary.classList.remove('hidden');
    els.pageList.classList.remove('hidden');
    els.total.textContent = result.total;
    els.eligible.textContent = ready;
    els.skipped.textContent = skipped;
    els.size.textContent = fmtBytes(selectedFile?.size || sourceBytes?.byteLength || 0);

    els.pageList.innerHTML = result.pages.map(p => `
      <div class="page-row">
        <strong>Page ${p.page}</strong>
        <span class="badge ${p.eligible ? 'ready' : 'skip'}">${p.eligible ? 'READY' : 'SKIPPED'}</span>
        <span class="page-reason">${p.reason}</span>
      </div>
    `).join('');
  }

  async function ensureAnalysis() {
    if (analysis) return analysis;
    analysis = await analyzePdf();
    renderAnalysis(analysis);
    return analysis;
  }

  async function buildPdf() {
    const result = await ensureAnalysis();
    const sourceCopy = new Uint8Array(sourceBytes);
    const doc = await PDFDocument.load(sourceCopy, { updateMetadata: false });
    const png = await doc.embedPng(await fetchFooterBytes());
    const pages = doc.getPages();

    const eligiblePages = result.pages.filter(p => p.eligible);
    for (let i = 0; i < eligiblePages.length; i++) {
      const meta = eligiblePages[i];
      setProgress(`Adding footer to page ${meta.page}…`, i, eligiblePages.length || 1);
      const page = pages[meta.page - 1];
      page.drawImage(png, { x: meta.xPt, y: meta.yPt, width: meta.wPt, height: meta.hPt });
    }

    setProgress('Saving PDF…', eligiblePages.length, eligiblePages.length || 1);
    const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
    return { bytes: out, eligible: eligiblePages.length, skipped: result.total - eligiblePages.length };
  }

  function clearOutputUrl() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
    els.downloadAgain.classList.add('hidden');
    els.downloadAgain.innerHTML = '';
  }

  function triggerDownload(bytes, filename) {
    clearOutputUrl();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    outputUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    els.downloadAgain.classList.remove('hidden');
    els.downloadAgain.innerHTML = `
      <strong>Done.</strong>
      <span>${filename} · ${fmtBytes(blob.size)}</span>
      <a href="${outputUrl}" download="${escapeHtml(filename)}">Download again</a>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  async function runAnalyze() {
    if (isBusy) return;
    clearError();
    clearOutputUrl();
    setBusy(true);
    els.empty.classList.add('hidden');
    try {
      analysis = await analyzePdf();
      renderAnalysis(analysis);
    } catch (err) {
      console.error(err);
      showError(normalizeError(err));
      analysis = null;
      renderAnalysis(null);
    } finally {
      hideProgress();
      setBusy(false);
    }
  }

  async function runProcess() {
    if (isBusy) return;
    clearError();
    setBusy(true);
    els.empty.classList.add('hidden');
    try {
      const built = await buildPdf();
      const filename = outputFilename();
      triggerDownload(built.bytes, filename);
      els.size.textContent = `${fmtBytes(selectedFile.size)} → ${fmtBytes(built.bytes.byteLength)}`;
    } catch (err) {
      console.error(err);
      showError(normalizeError(err));
    } finally {
      hideProgress();
      setBusy(false);
    }
  }

  function normalizeError(err) {
    const text = String(err?.message || err || 'Unknown error');
    if (/encrypted|password/i.test(text)) return 'This PDF appears to be password-protected or encrypted. Please use an unlocked PDF.';
    if (/Invalid PDF|Missing PDF/i.test(text)) return 'The selected file could not be read as a valid PDF.';
    return `Could not process this PDF: ${text}`;
  }

  function resetAll() {
    if (isBusy) return;
    selectedFile = null;
    sourceBytes = null;
    analysis = null;
    els.file.value = '';
    els.fileMeta.classList.add('hidden');
    els.fileMeta.textContent = '';
    clearOutputUrl();
    clearError();
    hideProgress();
    renderAnalysis(null);
    updateButtons();
  }

  ['input', 'change'].forEach(evt => {
    els.year.addEventListener(evt, updateFilename);
    els.subject.addEventListener(evt, updateFilename);
    els.language.addEventListener(evt, updateFilename);
  });

  els.file.addEventListener('change', () => handleFile(els.file.files?.[0]));
  els.browse.addEventListener('click', (e) => { e.preventDefault(); els.file.click(); });
  els.analyze.addEventListener('click', runAnalyze);
  els.process.addEventListener('click', runProcess);
  els.clear.addEventListener('click', resetAll);

  ['dragenter', 'dragover'].forEach(evt => els.drop.addEventListener(evt, e => {
    e.preventDefault(); els.drop.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(evt => els.drop.addEventListener(evt, e => {
    e.preventDefault(); els.drop.classList.remove('drag');
  }));
  els.drop.addEventListener('drop', e => handleFile(e.dataTransfer?.files?.[0]));

  updateFilename();
})();
