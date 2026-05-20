// ===== VoucherApp - Motor principal =====
// Reemplaza todo el backend Flask. Corre 100% en el WebView.
// La conexion al MikroTik se hace via plugin nativo Capacitor (SSH).

let routers = [];
let currentRouter = null;
let currentProfile = null;
let lastPdfData = null;

// ===== Utilidades =====

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show';
  setTimeout(() => t.className = 'toast', 2500);
}

function showModal(name) {
  document.getElementById('modal' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
}
function closeModal(name) {
  document.getElementById('modal' + name.charAt(0).toUpperCase() + name.slice(1)).classList.remove('active');
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if(e.target === el) el.classList.remove('active'); });
});

// ===== RouterOS API via Capacitor Plugin =====

async function callMikroTik(action, params) {
  if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.MikroTik) {
    const result = await Capacitor.Plugins.MikroTik.execute({ action, ...params });
    // El plugin devuelve {ok: bool, result: string, error?: string}
    if (result.ok === false) {
      throw new Error(result.error || 'Error desconocido');
    }
    return result.result || '';
  }
  return mockMikroTik(action, params);
}

async function fetchProfiles(ip, password) {
  const raw = await callMikroTik('profiles', { ip, password });
  const lines = raw.split('\n').filter(l => l.trim());
  let diagInfo = '';
  const profiles = [];
  for (const line of lines) {
    // Lines starting with __ are diagnostic/metadata, skip them
    if (line.startsWith('__')) {
      diagInfo += line + ' ';
      continue;
    }
    const parts = line.split(',');
    if (parts.length >= 3 && parts[0] !== 'name' && parts[0] !== '?') {
      profiles.push({
        name: parts[0],
        timelimit: parts[1],
        validez: parts.slice(2).join(','),
      });
    }
  }
  // Store diagnostics for debugging
  window.__diag = diagInfo;
  return profiles;
}

async function createUsers(ip, password, users, profile, timelimit) {
  const cmds = users.map(u => {
    let cmd = `/ip/hotspot/user/add name=${u.user} password=${u.pass} profile=${profile} server=all comment=up-${Date.now()}`;
    if (timelimit) cmd += ` limit-uptime=${timelimit}`;
    return cmd;
  });
  const raw = await callMikroTik('execute', { ip, password, commands: cmds.join('; ') });
  return raw;
}

// ===== Storage local =====

function loadRouters() {
  try {
    routers = JSON.parse(localStorage.getItem('voucher_routers') || '[]');
  } catch(e) { routers = []; }
  renderRouters();
}

function saveRouters() {
  localStorage.setItem('voucher_routers', JSON.stringify(routers));
  renderRouters();
}

function renderRouters() {
  const el = document.getElementById('routerList');
  document.getElementById('routerCount').textContent = routers.length + ' MikroTik';
  if (routers.length === 0) {
    el.innerHTML = '<div class="empty"><p>No hay MikroTiks agregados</p><p style="font-size:13px">Agrega el primero para empezar</p></div>';
    return;
  }
  el.innerHTML = routers.map(r => `
    <div class="card">
      <div class="card-title">${escHtml(r.name)}</div>
      <div class="card-sub">${escHtml(r.ip)} ${r.hotspotname ? '| ' + escHtml(r.hotspotname) : ''}</div>
      <div class="card-actions">
        <button class="btn btn-small btn-primary" onclick="openProfiles('${escAttr(r.id)}')">Planes</button>
        <button class="btn btn-small btn-outline" onclick="editRouter('${escAttr(r.id)}')">Editar</button>
        <button class="btn btn-small btn-danger" onclick="deleteRouter('${escAttr(r.id)}')">Eliminar</button>
      </div>
    </div>
  `).join('');
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function addRouter(name, ip, password, hotspotname) {
  routers.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name: name.trim(),
    ip: ip.trim(),
    password: password,
    hotspotname: (hotspotname || 'ZONA WIFI').trim().toUpperCase()
  });
  saveRouters();
}

function updateRouter(id, name, ip, password, hotspotname) {
  const r = routers.find(x => x.id === id);
  if (r) {
    r.name = name.trim();
    r.ip = ip.trim();
    r.password = password;
    r.hotspotname = (hotspotname || 'ZONA WIFI').trim().toUpperCase();
    saveRouters();
  }
}

// ===== Handlers de UI =====

function saveRouter() {
  const id = document.getElementById('routerId').value;
  const name = document.getElementById('routerName').value.trim();
  const ip = document.getElementById('routerIp').value.trim();
  const password = document.getElementById('routerPass').value.trim();
  const hsname = document.getElementById('routerHsName').value.trim();

  if (!name || !ip) { toast('Nombre e IP obligatorios'); return; }
  if (!password) { toast('Contraseña obligatoria'); return; }

  if (id) updateRouter(id, name, ip, password, hsname);
  else addRouter(name, ip, password, hsname);

  closeModal('router');
  toast('MikroTik guardado');
  document.getElementById('routerId').value = '';
  document.getElementById('routerName').value = '';
  document.getElementById('routerIp').value = '';
  document.getElementById('routerPass').value = '';
  document.getElementById('routerHsName').value = '';
}

function editRouter(id) {
  const r = routers.find(x => x.id === id);
  if (!r) return;
  document.getElementById('routerId').value = r.id;
  document.getElementById('routerName').value = r.name;
  document.getElementById('routerIp').value = r.ip;
  document.getElementById('routerPass').value = r.password;
  document.getElementById('routerHsName').value = r.hotspotname || '';
  document.getElementById('routerModalTitle').textContent = 'Editar MikroTik';
  showModal('router');
}

async function deleteRouter(id) {
  if (!confirm('¿Eliminar este MikroTik?')) return;
  routers = routers.filter(r => r.id !== id);
  saveRouters();
  toast('MikroTik eliminado');
}

// ===== Planes / Perfiles =====

async function openProfiles(routerId) {
  const r = routers.find(x => x.id === routerId);
  if (!r) return;
  currentRouter = r;
  document.getElementById('profileTitle').textContent = r.name;
  document.getElementById('profileList').innerHTML = '<div class="loading">Conectando...</div>';
  showModal('profiles');

  try {
    const profiles = await fetchProfiles(r.ip, r.password);
    if (!profiles || profiles.length === 0) {
      document.getElementById('profileList').innerHTML = '<div class="empty"><p>No se encontraron planes</p></div>';
      return;
    }
    document.getElementById('profileList').innerHTML = profiles.map(p => `
      <button class="profile-btn" onclick="openGenerate('${escAttr(p.name)}', '${escAttr(p.timelimit)}', '${escAttr(p.validez)}')">
        <strong>${escHtml(p.name)}</strong>
        <div class="sub">⏱ ${escHtml(p.timelimit)} &middot; Vence: ${escHtml(p.validez)}</div>
      </button>
    `).join('');
  } catch(e) {
    document.getElementById('profileList').innerHTML = `<div class="empty"><p>Error: ${escHtml(e.message || e)}</p><button class="btn btn-small btn-outline" style="margin-top:12px" onclick="openProfiles('${escAttr(routerId)}')">Reintentar</button></div>`;
  }
}

// ===== Generar vouchers =====

function openGenerate(profile, timelimit, validez) {
  currentProfile = { profile, timelimit, validez };
  document.getElementById('genTitle').textContent = profile;
  document.getElementById('genInfo').textContent = `⏱ Conexión: ${timelimit} | 🕐 Válido: ${validez}`;
  document.getElementById('genCount').value = 5;
  document.getElementById('genResult').style.display = 'none';
  closeModal('profiles');
  showModal('generate');
}

function randomUser() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({length:5}, () => chars[Math.floor(Math.random()*26)]).join('');
}
function randomPass() {
  return Array.from({length:5}, () => Math.floor(Math.random()*10)).join('');
}

async function generateVouchers() {
  const btn = document.querySelector('#modalGenerate .btn-success');
  btn.disabled = true; btn.textContent = 'Generando...';

  const count = parseInt(document.getElementById('genCount').value) || 5;
  const { profile, timelimit, validez } = currentProfile;
  const { ip, password, hotspotname } = currentRouter;
  const hotspotName = (hotspotname || 'ZONA WIFI').toUpperCase();

  const vouchers = Array.from({length: count}, () => ({ user: randomUser(), pass: randomPass() }));

  try {
    // Crear usuarios en MikroTik
    await createUsers(ip, password, vouchers, profile, timelimit);

    // Generar PDF
    const pdfBytes = await generarPDF(vouchers, hotspotName, profile, validez);
    lastPdfData = { bytes: pdfBytes, filename: `vouchers_${profile}_${Date.now()}.pdf` };

    // Mostrar resultado
    document.getElementById('genResult').style.display = 'block';
    document.getElementById('genVouchers').innerHTML = vouchers.map(v =>
      `<div class="voucher-item"><span class="v-user">${v.user}</span><span class="v-pass">${v.pass}</span></div>`
    ).join('');

    // Estilo inline para la grilla de vouchers
    const styleCheck = document.querySelector('#voucherGridStyle');
    if (!styleCheck) {
      const s = document.createElement('style');
      s.id = 'voucherGridStyle';
      s.textContent = `
        .voucher-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px;
        }
        .voucher-item {
          background: var(--bg); border-radius: 8px; padding: 10px; text-align: center;
        }
        .voucher-item .v-user { display: block; font-size: 16px; font-weight: 700; letter-spacing: 2px; }
        .voucher-item .v-pass { display: block; font-size: 14px; color: var(--text2); margin-top: 2px; }
      `;
      document.head.appendChild(s);
    }

    toast(`${vouchers.length} vouchers generados!`);
  } catch(e) {
    toast('Error: ' + (e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Generar';
  }
}

// ===== PDF Generation (pdf-lib) =====

async function generarPDF(vouchers, hotspotName, profile, validez) {
  // Cargar pdf-lib del CDN
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const doc = await PDFDocument.create();
  // Usar Helvetica (built-in, no necesita fuentes externas)
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Pagina: 102mm x 169mm (aprox 289 x 479 pt, 1mm = 2.83465pt)
  // Milimetros a puntos: 1mm = 72/25.4 ≈ 2.83465 pt
  const pt = 2.83465;
  const PW = 102 * pt;  // ~289 pt
  const PH = 169 * pt;  // ~479 pt

  // Voucher size: 60mm x 27mm
  const VW = 60 * pt;
  const VH = 27 * pt;
  const MARGIN = (PW - VW) / 2; // centrado horizontal
  const GAP = 3 * pt; // espacio entre vouchers

  let pageIndex = 0;

  for (let i = 0; i < vouchers.length; i++) {
    const pos = i % 3;
    if (pos === 0) {
      // Nueva pagina
      const page = doc.addPage([PW, PH]);
      pageIndex = doc.getPageCount() - 1;
    }

    const page = doc.getPage(pageIndex);
    const yStart = PH - (15 * pt) - pos * (VH + GAP);
    const v = vouchers[i];

    // Borde externo grueso
    page.drawRectangle({
      x: MARGIN, y: yStart - VH, width: VW, height: VH,
      borderColor: rgb(0, 0, 0), borderWidth: 1.5,
    });

    // Header: nombre del hotspot + contador
    const headerY = yStart - 6 * pt;
    page.drawText(hotspotName, {
      x: MARGIN + 4 * pt, y: headerY, size: 9,
      font: fontBold, color: rgb(0, 0, 0),
    });
    page.drawText(`[${i+1}]`, {
      x: MARGIN + VW - 14 * pt, y: headerY, size: 7,
      font: font, color: rgb(0, 0, 0),
    });

    // Linea separadora
    page.drawLine({
      start: { x: MARGIN + 4 * pt, y: yStart - 9 * pt },
      end: { x: MARGIN + VW - 4 * pt, y: yStart - 9 * pt },
      thickness: 0.5, color: rgb(0, 0, 0),
    });

    // Labels
    const labelY = yStart - 11.5 * pt;
    const colW = (VW - 12 * pt) / 2;
    page.drawText('Username', {
      x: MARGIN + 4 * pt, y: labelY, size: 5.5, font: font, color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText('Password', {
      x: MARGIN + 6 * pt + colW, y: labelY, size: 5.5, font: font, color: rgb(0.3, 0.3, 0.3),
    });

    // Credenciales con borde
    const credY = yStart - 17 * pt;
    page.drawRectangle({
      x: MARGIN + 4 * pt, y: credY, width: colW, height: 5.5 * pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5,
    });
    page.drawText(v.user, {
      x: MARGIN + 4 * pt + 2 * pt, y: credY + 1 * pt, size: 10,
      font: fontBold, color: rgb(0,0,0),
    });
    page.drawRectangle({
      x: MARGIN + 6 * pt + colW, y: credY, width: colW, height: 5.5 * pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5,
    });
    page.drawText(v.pass, {
      x: MARGIN + 8 * pt + colW, y: credY + 1 * pt, size: 10,
      font: fontBold, color: rgb(0,0,0),
    });

    // Footer: perfil | validez
    const footY = credY - 7 * pt;
    page.drawRectangle({
      x: MARGIN + 4 * pt, y: footY, width: VW - 8 * pt, height: 5 * pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5,
    });
    page.drawText(`${profile} | ${validez}`, {
      x: MARGIN + 6 * pt, y: footY + 0.5 * pt, size: 7,
      font: fontBold, color: rgb(0,0,0),
    });
  }

  return await doc.save();
}

function downloadPDF() {
  if (!lastPdfData) return;
  const blob = new Blob([lastPdfData.bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lastPdfData.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function sharePDF() {
  if (!lastPdfData) return;
  const blob = new Blob([lastPdfData.bytes], { type: 'application/pdf' });

  if (navigator.share && navigator.canShare) {
    const file = new File([blob], lastPdfData.filename, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Vouchers' });
        return;
      } catch(e) { /* user cancelled */ }
    }
  }
  // Fallback: descargar
  downloadPDF();
}

// ===== Mock offline para pruebas en navegador =====

function mockMikroTik(action, params) {
  if (action === 'profiles') {
    return [
      '1HORA,1h,3 días',
      '2HORAS,2h,3 días',
      '1DIA,1d,3 días',
      '7DIAS,7d,7 días',
      '15DIAS,15d,15 días',
      '30DIAS,30d,30 días',
    ].join('\n');
  }
  if (action === 'execute') {
    return 'Usuarios creados exitosamente';
  }
  return 'OK';
}

// ===== Inicializacion =====

(function init() {
  loadRouters();
})();
