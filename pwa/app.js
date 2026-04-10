/*!
 * Field Timestamp Camera — PWA
 * © 2026 Renova Renewables. All rights reserved.
 * Licensed use only. Unauthorized copying, modification, or distribution
 * of this software, via any medium, is strictly prohibited.
 */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let mediaStream    = null;
let overlayAnchor  = { x: 0.02, y: 0.70 };
let overlayBg      = 'black';   // 'black' | 'white' | 'none'
let flashOn        = false;
let torchSupported = false;
let gpsPosition    = null;
let reverseAddress = null;   // from GPS/Nominatim
let addressOverride = null;  // manually typed by user (null = use GPS address)
let geocodePending = false;
let capturedPhotos = [];     // { blob, filename, objectUrl }

// Job info (persisted in localStorage)
let jobName  = localStorage.getItem('ftc_job_name')  || '';
let crewName = localStorage.getItem('ftc_crew_name') || '';

// Zoom
let currentZoom    = 1;
let minZoom        = 1;
let maxZoom        = 8;
let hwZoom         = false;   // true = hardware zoom via applyConstraints

const BG_MODES = ['black', 'white', 'none'];
const BG_ICONS = { black: '■', white: '□', none: '◇' };

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let video, overlayDiv, overlayTextEl, shutterBtn, flashBtn, bgBtn,
    galleryBtn, galleryBadge, statusBar, captureFlash,
    galleryPanel, galleryGrid, galleryCount,
    addrModal, addrInput, zoomPill,
    jobModal, jobInput, crewInput;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  video          = document.getElementById('preview');
  overlayDiv     = document.getElementById('overlay-drag');
  overlayTextEl  = document.getElementById('overlay-text');
  shutterBtn     = document.getElementById('shutter');
  flashBtn       = document.getElementById('flash-btn');
  bgBtn          = document.getElementById('bg-btn');
  galleryBtn     = document.getElementById('gallery-btn');
  galleryBadge   = document.getElementById('gallery-badge');
  statusBar      = document.getElementById('status-bar');
  captureFlash   = document.getElementById('capture-flash');
  galleryPanel   = document.getElementById('gallery-panel');
  galleryGrid    = document.getElementById('gallery-grid');
  galleryCount   = document.getElementById('gallery-count');
  addrModal      = document.getElementById('addr-modal');
  addrInput      = document.getElementById('addr-input');
  zoomPill       = document.getElementById('zoom-pill');
  jobModal       = document.getElementById('job-modal');
  jobInput       = document.getElementById('job-input');
  crewInput      = document.getElementById('crew-input');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus('Camera requires HTTPS — open via https://', 0);
    return;
  }

  initCamera();
  initGPS();
  initDrag();
  initDoubleTap();
  initPinchZoom();
  zoomPill.addEventListener('click', cycleZoomPreset);
  setInterval(updateOverlayPreview, 1000);

  shutterBtn.addEventListener('click',   capturePhoto);
  flashBtn.addEventListener('click',     toggleFlash);
  bgBtn.addEventListener('click',        cycleBg);
  galleryBtn.addEventListener('click',   openGallery);
  const jobBtn = document.getElementById('job-btn');
  jobBtn.addEventListener('click', openJobModal);
  jobBtn.classList.toggle('active', !!(jobName || crewName));

  // Gallery panel
  document.getElementById('close-gallery-btn').addEventListener('click',  closeGallery);
  document.getElementById('share-all-btn').addEventListener('click',      shareAll);
  document.getElementById('save-device-btn').addEventListener('click',    saveToDevice);
  document.getElementById('clear-all-btn').addEventListener('click',      clearAll);

  // Address modal
  document.getElementById('addr-save-btn').addEventListener('click',   saveAddress);
  document.getElementById('addr-cancel-btn').addEventListener('click', closeAddrModal);
  document.getElementById('addr-gps-btn').addEventListener('click',    resetToGpsAddress);
  addrModal.addEventListener('click', e => { if (e.target === addrModal) closeAddrModal(); });
  addrInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveAddress(); });

  // Job modal
  document.getElementById('job-save-btn').addEventListener('click',   saveJobInfo);
  document.getElementById('job-cancel-btn').addEventListener('click', closeJobModal);
  jobModal.addEventListener('click', e => { if (e.target === jobModal) closeJobModal(); });
  [jobInput, crewInput].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveJobInfo(); })
  );

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
});

// ─── Camera ───────────────────────────────────────────────────────────────────
async function initCamera() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 4096 },
        height: { ideal: 2160 },
      },
      audio: false,
    });
    video.srcObject = mediaStream;

    const track = mediaStream.getVideoTracks()[0];
    const caps  = track.getCapabilities ? track.getCapabilities() : {};

    torchSupported = !!caps.torch;
    if (torchSupported) flashBtn.disabled = false;

    // Hardware zoom support (Android Chrome)
    if (caps.zoom) {
      hwZoom   = true;
      minZoom  = caps.zoom.min;
      maxZoom  = caps.zoom.max;
      currentZoom = caps.zoom.min;
    } else {
      hwZoom  = false;
      minZoom = 1;
      maxZoom = 8;
      currentZoom = 1;
    }
    updateZoomPill();

  } catch (err) {
    showStatus('Camera error: ' + err.message, 0);
  }
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
async function setZoom(z) {
  currentZoom = Math.max(minZoom, Math.min(maxZoom, z));
  if (hwZoom && mediaStream) {
    try {
      await mediaStream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: currentZoom }] });
    } catch (_) { /* ignore */ }
  } else {
    // CSS digital zoom — scale video, capture will crop centre
    video.style.transform       = currentZoom > 1 ? `scale(${currentZoom})` : '';
    video.style.transformOrigin = '50% 50%';
  }
  updateZoomPill();
}

function updateZoomPill() {
  zoomPill.textContent = currentZoom.toFixed(1) + '×';
  zoomPill.classList.toggle('zoomed', currentZoom > (minZoom + 0.05));
}

// Tap the pill to snap to preset levels: 1× → 2× → 4× → back to min
function cycleZoomPreset() {
  const presets = [minZoom, 2, 4].filter(p => p <= maxZoom);
  if (presets[presets.length - 1] < maxZoom) presets.push(maxZoom);
  const next = presets.find(p => p > currentZoom + 0.05) || presets[0];
  setZoom(next);
}

// Pinch-to-zoom on the camera view
function initPinchZoom() {
  const view = document.getElementById('camera-view');
  let startDist = null, startZoom = 1;

  function dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  view.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      startDist = dist(e.touches);
      startZoom = currentZoom;
      e.preventDefault();
    }
  }, { passive: false });

  view.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && startDist) {
      setZoom(startZoom * dist(e.touches) / startDist);
      e.preventDefault();
    }
  }, { passive: false });

  view.addEventListener('touchend', () => { startDist = null; });
}

// ─── GPS ──────────────────────────────────────────────────────────────────────
function initGPS() {
  if (!navigator.geolocation) { showStatus('GPS unavailable', 3000); return; }
  showStatus('Acquiring GPS…', 0);
  navigator.geolocation.watchPosition(onPosition, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 15000,
  });
}

function onPosition(pos) {
  const needsGeocode = !gpsPosition || hasMoved(gpsPosition.coords, pos.coords, 20);
  gpsPosition = pos;
  showStatus('GPS ±' + Math.round(pos.coords.accuracy) + 'm', 2500);
  if (needsGeocode) fetchAddress(pos.coords.latitude, pos.coords.longitude);
}

function onGpsError(err) { showStatus('GPS: ' + err.message, 4000); }

function hasMoved(a, b, m) {
  const R = 6371000, dLa = (b.latitude - a.latitude) * Math.PI / 180,
        dLo = (b.longitude - a.longitude) * Math.PI / 180;
  return Math.sqrt(dLa * dLa + dLo * dLo) * R > m;
}

async function fetchAddress(lat, lon) {
  if (geocodePending) return;
  geocodePending = true;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    const a = d.address || {};
    const parts = [
      a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
      a.city || a.town || a.village || a.county,
      a.state,
    ].filter(Boolean);
    reverseAddress = parts.length ? parts.join(', ') : null;
  } catch (_) { /* silent */ }
  geocodePending = false;
}

// ─── Overlay text ─────────────────────────────────────────────────────────────
function activeAddress() {
  return addressOverride !== null ? addressOverride : reverseAddress;
}

function buildLines() {
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const lines = [];
  if (jobName)  lines.push(jobName);
  if (crewName) lines.push(crewName);
  lines.push(date, time);

  if (gpsPosition) {
    const { latitude: lat, longitude: lon } = gpsPosition.coords;
    lines.push(`${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'},  ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`);
    const addr = activeAddress();
    if (addr) lines.push(addr);
  } else {
    lines.push('Acquiring GPS…');
  }
  return lines;
}

function updateOverlayPreview() {
  const lines = buildLines();
  const addr  = activeAddress();
  const html = lines.map((l, i) => {
    const isAddrLine = gpsPosition && addr && i === lines.length - 1 && l === addr;
    if (isAddrLine) {
      return `<div class="addr-line">${esc(l)}<span class="edit-addr" id="edit-addr-btn">✏</span></div>`;
    }
    return `<div>${esc(l)}</div>`;
  }).join('');

  overlayTextEl.innerHTML = html;

  // Re-attach tap handler on the edit icon (re-rendered each tick)
  const editBtn = document.getElementById('edit-addr-btn');
  if (editBtn) {
    editBtn.addEventListener('touchend', e => { e.stopPropagation(); openAddrModal(); }, { once: true });
    editBtn.addEventListener('click',    e => { e.stopPropagation(); openAddrModal(); }, { once: true });
  }

  // Reposition overlay within bounds
  const parent = overlayDiv.parentElement;
  const pw = parent.clientWidth,  ph = parent.clientHeight;
  const ow = overlayDiv.offsetWidth  || 220;
  const oh = overlayDiv.offsetHeight || 80;
  overlayDiv.style.left = Math.max(4, Math.min(overlayAnchor.x * pw, pw - ow - 4)) + 'px';
  overlayDiv.style.top  = Math.max(4, Math.min(overlayAnchor.y * ph, ph - oh - 4)) + 'px';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Double-tap overlay → address modal ──────────────────────────────────────
function initDoubleTap() {
  let lastTap = 0;
  overlayDiv.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 320) {
      e.preventDefault();
      openAddrModal();
    }
    lastTap = now;
  });
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
function initDrag() {
  let dragging = false, moved = false, sx, sy, sl, st;

  function start(e) {
    if (e.target.id === 'edit-addr-btn') return;
    dragging = true; moved = false;
    const p = e.touches ? e.touches[0] : e;
    sx = p.clientX; sy = p.clientY;
    sl = overlayDiv.offsetLeft; st = overlayDiv.offsetTop;
    e.preventDefault();
  }

  function move(e) {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    moved = true;
    const parent = overlayDiv.parentElement;
    const maxL = parent.clientWidth  - overlayDiv.offsetWidth  - 4;
    const maxT = parent.clientHeight - overlayDiv.offsetHeight - 4;
    const nl = Math.max(4, Math.min(sl + (p.clientX - sx), maxL));
    const nt = Math.max(4, Math.min(st + (p.clientY - sy), maxT));
    overlayDiv.style.left = nl + 'px';
    overlayDiv.style.top  = nt + 'px';
    overlayAnchor.x = nl / parent.clientWidth;
    overlayAnchor.y = nt / parent.clientHeight;
    e.preventDefault();
  }

  function end() { dragging = false; }

  overlayDiv.addEventListener('mousedown',  start);
  overlayDiv.addEventListener('touchstart', start, { passive: false });
  document.addEventListener('mousemove',  move);
  document.addEventListener('touchmove',  move, { passive: false });
  document.addEventListener('mouseup',    end);
  document.addEventListener('touchend',   end);
}

// ─── Address modal ────────────────────────────────────────────────────────────
function openAddrModal() {
  addrInput.value = activeAddress() || '';
  addrModal.classList.remove('hidden');
  setTimeout(() => addrInput.focus(), 50);
}

function closeAddrModal() {
  addrModal.classList.add('hidden');
  addrInput.blur();
}

function saveAddress() {
  const val = addrInput.value.trim();
  addressOverride = val.length ? val : null;
  closeAddrModal();
  updateOverlayPreview();
}

function resetToGpsAddress() {
  addressOverride = null;
  closeAddrModal();
  updateOverlayPreview();
}

// ─── Job / Crew modal ─────────────────────────────────────────────────────────
function openJobModal() {
  jobInput.value  = jobName;
  crewInput.value = crewName;
  jobModal.classList.remove('hidden');
  setTimeout(() => jobInput.focus(), 50);
}

function closeJobModal() {
  jobModal.classList.add('hidden');
  jobInput.blur();
  crewInput.blur();
}

function saveJobInfo() {
  jobName  = jobInput.value.trim();
  crewName = crewInput.value.trim();
  localStorage.setItem('ftc_job_name',  jobName);
  localStorage.setItem('ftc_crew_name', crewName);
  closeJobModal();
  updateOverlayPreview();
  // Update button to show indicator when fields are filled
  document.getElementById('job-btn').classList.toggle('active', !!(jobName || crewName));
}

// ─── Capture → queue ──────────────────────────────────────────────────────────
async function capturePhoto() {
  shutterBtn.disabled = true;

  captureFlash.style.opacity = '1';
  setTimeout(() => { captureFlash.style.opacity = '0'; }, 100);

  try {
    const canvas  = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx     = canvas.getContext('2d');

    if (!hwZoom && currentZoom > 1) {
      // Crop the centre to simulate digital zoom for captured photo
      const sw = canvas.width  / currentZoom;
      const sh = canvas.height / currentZoom;
      const sx = (canvas.width  - sw) / 2;
      const sy = (canvas.height - sh) / 2;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(video, 0, 0);
    }

    drawOverlay(ctx, canvas.width, canvas.height, buildLines());

    let dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    if (gpsPosition && typeof piexif !== 'undefined') {
      dataUrl = embedExif(dataUrl, gpsPosition.coords, new Date());
    }

    const blob      = dataUrlToBlob(dataUrl);
    const filename  = 'FTC_' + fmtDateFilename(new Date()) + '.jpg';
    const objectUrl = URL.createObjectURL(blob);

    capturedPhotos.push({ blob, filename, objectUrl });
    updateGalleryBadge();
    showStatus(`Photo ${capturedPhotos.length} captured`, 1500);
  } catch (err) {
    showStatus('Capture error: ' + err.message, 4000);
  }

  shutterBtn.disabled = false;
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
function updateGalleryBadge() {
  const n = capturedPhotos.length;
  galleryBadge.textContent = n;
  galleryBadge.classList.toggle('hidden', n === 0);
}

function openGallery() {
  renderGalleryGrid();
  galleryPanel.classList.remove('hidden');
}

function closeGallery() {
  galleryPanel.classList.add('hidden');
}

function renderGalleryGrid() {
  galleryCount.textContent = capturedPhotos.length + (capturedPhotos.length === 1 ? ' photo' : ' photos');

  if (capturedPhotos.length === 0) {
    galleryGrid.innerHTML = '<div class="gallery-empty">No photos yet.<br>Take some shots first.</div>';
    return;
  }

  galleryGrid.innerHTML = capturedPhotos.map((p, i) => `
    <div class="gallery-thumb" data-index="${i}">
      <img src="${p.objectUrl}" alt="Photo ${i + 1}">
      <button class="thumb-del" data-index="${i}" title="Delete">✕</button>
      <button class="thumb-share" data-index="${i}" title="Share">↑</button>
    </div>
  `).join('');

  galleryGrid.querySelectorAll('.thumb-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deletePhoto(parseInt(btn.dataset.index));
    });
  });

  galleryGrid.querySelectorAll('.thumb-share').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      shareOne(parseInt(btn.dataset.index));
    });
  });
}

function deletePhoto(index) {
  URL.revokeObjectURL(capturedPhotos[index].objectUrl);
  capturedPhotos.splice(index, 1);
  updateGalleryBadge();
  renderGalleryGrid();
}

async function shareOne(index) {
  const p = capturedPhotos[index];
  await shareFiles([new File([p.blob], p.filename, { type: 'image/jpeg' })]);
}

async function shareAll() {
  if (capturedPhotos.length === 0) return;
  const files = capturedPhotos.map(p => new File([p.blob], p.filename, { type: 'image/jpeg' }));
  await shareFiles(files);
}

async function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'Field Timestamp Photos' });
      showStatus('Shared!', 2000);
      return;
    } catch (e) {
      if (e.name === 'AbortError') { showStatus('Cancelled', 1500); return; }
    }
  }
  // Fallback: download each file
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a   = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  showStatus(`Downloaded ${files.length} photo${files.length > 1 ? 's' : ''}`, 2000);
}

function saveToDevice() {
  if (capturedPhotos.length === 0) return;

  // Trigger all downloads synchronously in one user-gesture tick.
  // Android Chrome allows multiple <a download> clicks within the same handler.
  const urls = capturedPhotos.map(p => {
    const url = URL.createObjectURL(p.blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: p.filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return url;
  });

  setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 15000);
  showStatus(`Saving ${capturedPhotos.length} photo${capturedPhotos.length > 1 ? 's' : ''}…`, 3000);
}

function clearAll() {
  if (capturedPhotos.length === 0) { closeGallery(); return; }
  capturedPhotos.forEach(p => URL.revokeObjectURL(p.objectUrl));
  capturedPhotos = [];
  updateGalleryBadge();
  closeGallery();
  showStatus('Cleared', 1500);
}

// ─── Canvas overlay rendering ─────────────────────────────────────────────────
function drawOverlay(ctx, w, h, lines) {
  const fs  = Math.round(w * 0.022);
  const pad = Math.round(fs * 0.5);
  const lh  = Math.round(fs * 1.65);

  ctx.save();
  ctx.font      = `bold ${fs}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';

  const maxW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const boxW = maxW + pad * 2;
  const boxH = lines.length * lh + pad;

  const bx = Math.max(4, Math.min(Math.round(overlayAnchor.x * w), w - boxW - 4));
  const by = Math.max(4, Math.min(Math.round(overlayAnchor.y * h), h - boxH - 4));

  if (overlayBg !== 'none') {
    ctx.fillStyle = overlayBg === 'black' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    rrect(ctx, bx, by, boxW, boxH, 6);
    ctx.fill();
  }

  ctx.fillStyle = overlayBg === 'white' ? '#000' : '#fff';
  if (overlayBg === 'none') {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 5;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 1;
  }

  lines.forEach((line, i) => {
    ctx.fillText(line, bx + pad, by + pad + (i + 0.82) * lh);
  });

  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// ─── EXIF ─────────────────────────────────────────────────────────────────────
function dms(decimal) {
  const a = Math.abs(decimal), d = Math.floor(a);
  const mf = (a - d) * 60, m = Math.floor(mf);
  return [[d, 1], [m, 1], [Math.round((mf - m) * 60 * 1000), 1000]];
}

function exifDate(dt) {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}:${p(dt.getMonth()+1)}:${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function embedExif(dataUrl, coords, dt) {
  try {
    const ts = exifDate(dt);
    return piexif.insert(piexif.dump({
      '0th': {
        [piexif.ImageIFD.Make]:            'FieldTimestampCamera',
        [piexif.ImageIFD.Software]:         'Field Timestamp Camera PWA',
        [piexif.ImageIFD.DateTime]:         ts,
        [piexif.ImageIFD.ImageDescription]: activeAddress() || '',
      },
      Exif: {
        [piexif.ExifIFD.DateTimeOriginal]:  ts,
        [piexif.ExifIFD.DateTimeDigitized]: ts,
      },
      GPS: {
        [piexif.GPSIFD.GPSLatitudeRef]:  coords.latitude  >= 0 ? 'N' : 'S',
        [piexif.GPSIFD.GPSLatitude]:     dms(coords.latitude),
        [piexif.GPSIFD.GPSLongitudeRef]: coords.longitude >= 0 ? 'E' : 'W',
        [piexif.GPSIFD.GPSLongitude]:    dms(coords.longitude),
      },
    }), dataUrl);
  } catch (e) {
    console.error('EXIF:', e);
    return dataUrl;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(data);
  const buf  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function fmtDateFilename(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function toggleFlash() {
  if (!torchSupported || !mediaStream) return;
  flashOn = !flashOn;
  try {
    await mediaStream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: flashOn }] });
    flashBtn.classList.toggle('active', flashOn);
  } catch (_) { flashOn = !flashOn; }
}

function cycleBg() {
  const i = BG_MODES.indexOf(overlayBg);
  overlayBg = BG_MODES[(i + 1) % BG_MODES.length];
  bgBtn.textContent     = BG_ICONS[overlayBg];
  overlayDiv.dataset.bg = overlayBg;
}

let statusTimer;
function showStatus(msg, ms) {
  statusBar.textContent   = msg;
  statusBar.style.opacity = '1';
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = setTimeout(() => { statusBar.style.opacity = '0'; }, ms);
}
