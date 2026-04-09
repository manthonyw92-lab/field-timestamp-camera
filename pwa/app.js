'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let mediaStream    = null;
let overlayAnchor  = { x: 0.02, y: 0.70 };
let overlayBg      = 'black';   // 'black' | 'white' | 'none'
let flashOn        = false;
let torchSupported = false;
let gpsPosition    = null;
let reverseAddress = null;
let geocodePending = false;

const BG_MODES = ['black', 'white', 'none'];
const BG_ICONS = { black: '■', white: '□', none: '◇' };

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let video, overlayDiv, overlayTextEl, shutterBtn, flashBtn, bgBtn, statusBar, captureFlash;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  video          = document.getElementById('preview');
  overlayDiv     = document.getElementById('overlay-drag');
  overlayTextEl  = document.getElementById('overlay-text');
  shutterBtn     = document.getElementById('shutter');
  flashBtn       = document.getElementById('flash-btn');
  bgBtn          = document.getElementById('bg-btn');
  statusBar      = document.getElementById('status-bar');
  captureFlash   = document.getElementById('capture-flash');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus('Camera requires HTTPS — open via https://', 0);
    return;
  }

  initCamera();
  initGPS();
  initDrag();
  setInterval(updateOverlayPreview, 1000);

  shutterBtn.addEventListener('click', capturePhoto);
  flashBtn.addEventListener('click',   toggleFlash);
  bgBtn.addEventListener('click',      cycleBg);

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

    // Detect torch support (Android Chrome; not available on iOS)
    const track = mediaStream.getVideoTracks()[0];
    const caps  = track.getCapabilities ? track.getCapabilities() : {};
    torchSupported = !!caps.torch;
    if (torchSupported) flashBtn.disabled = false;

  } catch (err) {
    showStatus('Camera error: ' + err.message, 0);
  }
}

// ─── GPS ──────────────────────────────────────────────────────────────────────
function initGPS() {
  if (!navigator.geolocation) {
    showStatus('GPS unavailable', 3000);
    return;
  }
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

function onGpsError(err) {
  showStatus('GPS: ' + err.message, 4000);
}

function hasMoved(a, b, thresholdMeters) {
  const R   = 6371000;
  const dLa = (b.latitude  - a.latitude)  * Math.PI / 180;
  const dLo = (b.longitude - a.longitude) * Math.PI / 180;
  return Math.sqrt(dLa * dLa + dLo * dLo) * R > thresholdMeters;
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
  } catch (_) { /* silent fail */ }
  geocodePending = false;
}

// ─── Overlay preview ──────────────────────────────────────────────────────────
function buildLines() {
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const lines = [date, time];

  if (gpsPosition) {
    const { latitude: lat, longitude: lon } = gpsPosition.coords;
    const latStr = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
    lines.push(`${latStr},  ${lonStr}`);
    if (reverseAddress) lines.push(reverseAddress);
  } else {
    lines.push('Acquiring GPS…');
  }

  return lines;
}

function updateOverlayPreview() {
  overlayTextEl.innerHTML = buildLines().map(l => `<div>${esc(l)}</div>`).join('');

  // Keep overlay within camera-view bounds
  const parent = overlayDiv.parentElement;
  const pw = parent.clientWidth,  ph = parent.clientHeight;
  const ow = overlayDiv.offsetWidth  || 220;
  const oh = overlayDiv.offsetHeight || 80;
  const lx = Math.max(4, Math.min(overlayAnchor.x * pw, pw - ow - 4));
  const ly = Math.max(4, Math.min(overlayAnchor.y * ph, ph - oh - 4));
  overlayDiv.style.left = lx + 'px';
  overlayDiv.style.top  = ly + 'px';
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Drag ─────────────────────────────────────────────────────────────────────
function initDrag() {
  let dragging = false, sx, sy, sl, st;

  function start(e) {
    dragging = true;
    const p = e.touches ? e.touches[0] : e;
    sx = p.clientX; sy = p.clientY;
    sl = overlayDiv.offsetLeft;
    st = overlayDiv.offsetTop;
    e.preventDefault();
  }

  function move(e) {
    if (!dragging) return;
    const p      = e.touches ? e.touches[0] : e;
    const parent = overlayDiv.parentElement;
    const maxL   = parent.clientWidth  - overlayDiv.offsetWidth  - 4;
    const maxT   = parent.clientHeight - overlayDiv.offsetHeight - 4;
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

// ─── Capture ──────────────────────────────────────────────────────────────────
async function capturePhoto() {
  shutterBtn.disabled = true;

  // White flash feedback
  captureFlash.style.opacity = '1';
  setTimeout(() => { captureFlash.style.opacity = '0'; }, 100);

  try {
    const canvas  = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx     = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    drawOverlay(ctx, canvas.width, canvas.height, buildLines());

    let dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    if (gpsPosition && typeof piexif !== 'undefined') {
      dataUrl = embedExif(dataUrl, gpsPosition.coords, new Date());
    }

    const blob     = dataUrlToBlob(dataUrl);
    const filename = 'FTC_' + fmtDateFilename(new Date()) + '.jpg';
    await savePhoto(blob, filename);
  } catch (err) {
    showStatus('Capture error: ' + err.message, 4000);
  }

  shutterBtn.disabled = false;
}

// ─── Canvas overlay rendering ─────────────────────────────────────────────────
function drawOverlay(ctx, w, h, lines) {
  const fs  = Math.round(w * 0.022);
  const pad = Math.round(fs * 0.5);
  const lh  = Math.round(fs * 1.65);

  ctx.save();
  ctx.font      = `bold ${fs}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';

  const maxW  = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const boxW  = maxW + pad * 2;
  const boxH  = lines.length * lh + pad;

  // Map normalized anchor to photo pixels
  const bx = Math.max(4, Math.min(Math.round(overlayAnchor.x * w), w - boxW - 4));
  const by = Math.max(4, Math.min(Math.round(overlayAnchor.y * h), h - boxH - 4));

  // Background
  if (overlayBg !== 'none') {
    ctx.fillStyle = overlayBg === 'black' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    rrect(ctx, bx, by, boxW, boxH, 6);
    ctx.fill();
  }

  // Text
  ctx.fillStyle = (overlayBg === 'white') ? '#000' : '#fff';
  if (overlayBg === 'none') {
    ctx.shadowColor   = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur    = 5;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  }

  lines.forEach((line, i) => {
    ctx.fillText(line, bx + pad, by + pad + (i + 0.82) * lh);
  });

  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
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
  const a   = Math.abs(decimal);
  const d   = Math.floor(a);
  const mf  = (a - d) * 60;
  const m   = Math.floor(mf);
  const sec = Math.round((mf - m) * 60 * 1000);
  return [[d, 1], [m, 1], [sec, 1000]];
}

function exifDate(dt) {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}:${p(dt.getMonth()+1)}:${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function embedExif(dataUrl, coords, dt) {
  try {
    const ts = exifDate(dt);
    const exifObj = {
      '0th': {
        [piexif.ImageIFD.Make]:            'FieldTimestampCamera',
        [piexif.ImageIFD.Software]:         'Field Timestamp Camera PWA',
        [piexif.ImageIFD.DateTime]:         ts,
        [piexif.ImageIFD.ImageDescription]: reverseAddress || '',
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
    };
    return piexif.insert(piexif.dump(exifObj), dataUrl);
  } catch (e) {
    console.error('EXIF embed failed:', e);
    return dataUrl;
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────
function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(data);
  const buf  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

async function savePhoto(blob, filename) {
  const file = new File([blob], filename, { type: 'image/jpeg' });

  // Web Share API: on iOS this pops the share sheet where user can "Save Image"
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Field Timestamp Photo' });
      showStatus('Saved!', 2000);
      return;
    } catch (e) {
      if (e.name === 'AbortError') { showStatus('Cancelled', 1500); return; }
      // fall through to download
    }
  }

  // Fallback: trigger browser download (works on Android Chrome, desktop)
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showStatus('Photo downloaded', 2000);
}

// ─── Controls ─────────────────────────────────────────────────────────────────
async function toggleFlash() {
  if (!torchSupported || !mediaStream) return;
  flashOn = !flashOn;
  try {
    await mediaStream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: flashOn }] });
    flashBtn.classList.toggle('active', flashOn);
  } catch (_) {
    flashOn = !flashOn; // revert on error
  }
}

function cycleBg() {
  const i = BG_MODES.indexOf(overlayBg);
  overlayBg = BG_MODES[(i + 1) % BG_MODES.length];
  bgBtn.textContent       = BG_ICONS[overlayBg];
  overlayDiv.dataset.bg   = overlayBg;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDateFilename(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let statusTimer;
function showStatus(msg, ms) {
  statusBar.textContent    = msg;
  statusBar.style.opacity  = '1';
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = setTimeout(() => { statusBar.style.opacity = '0'; }, ms);
}
