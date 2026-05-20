// ===== VoucherApp - Motor principal =====
// Conexion al MikroTik via Android WebView JS Bridge

let routers = [];
let currentRouter = null;
let currentProfile = null;
let lastPdfData = null;
let usingAndroidBridge = false;

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

// ===== RouterOS API via Android Bridge =====

function bridgeAvailable() {
  return typeof AndroidBridge !== 'undefined' && AndroidBridge.mikroTikExecute;
}

async function callMikroTik(action, params) {
  if (bridgeAvailable()) {
    var result = AndroidBridge.mikroTikExecute(
      params.ip || '',
      params.password || '',
      action,
      params.commands || ''
    );
    // Result is JSON string from Java
    var data = JSON.parse(result);
    if (data.ok === false) {
      throw new Error(data.error || 'Error en MikroTik');
    }
    return data.result || '';
  }
  return mockMikroTik(action, params);
}

function testConnection() {
  if (bridgeAvailable()) {
    toast('✅ Bridge Android disponible');
  } else if (typeof Capacitor !== 'undefined') {
    toast('⚠️ Capacitor detectado pero sin plugin MikroTik');
  } else {
    toast('❌ Sin bridge - modo demo');
  }
}

async function fetchProfiles(ip, password) {
  const raw = await callMikroTik('profiles', { ip, password });
  const lines = raw.split('\n').filter(l => l.trim());
  const profiles = [];
  let diagLines = [];
  for (const line of lines) {
    if (line.startsWith('__')) {
      diagLines.push(line);
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
  window.__diagLines = diagLines;
  return profiles;
}

async function createUsers(ip, password, users, profile, timelimit) {
  // Comment formato Mikhmon: up-XXX-MM.DD.YY-
  var now = new Date();
  var mm = String(now.getMonth()+1).padStart(2,'0');
  var dd = String(now.getDate()).padStart(2,'0');
  var yy = String(now.getFullYear()).slice(-2);
  var rand = Math.floor(Math.random()*900)+100;
  var comment = 'up-' + rand + '-' + mm + '.' + dd + '.' + yy + '-';

  const cmds = users.map(u => {
    let cmd = `/ip/hotspot/user/add name=${u.user} password=${u.pass} profile=${profile} server=all comment=${comment}`;
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
  var hasBridge = bridgeAvailable();
  document.getElementById('routerCount').textContent = routers.length + ' MikroTik';
  var warn = document.getElementById('mockWarning');
  if (warn) warn.style.display = hasBridge ? 'none' : 'block';

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

// ===== Planes =====

async function openProfiles(routerId) {
  const r = routers.find(x => x.id === routerId);
  if (!r) return;
  currentRouter = r;
  document.getElementById('profileTitle').textContent = r.name;
  document.getElementById('profileList').innerHTML = '<div class="loading">Conectando...</div>';
  showModal('profiles');

  try {
    // Test bridge first
    if (!bridgeAvailable()) {
      document.getElementById('profileList').innerHTML = '<div class="empty"><p>⚠️ Sin conexion al MikroTik</p><p style="font-size:12px;color:var(--text2)">Modo demo - datos de prueba</p></div>' + getMockProfileButtons();
      return;
    }

    const profiles = await fetchProfiles(r.ip, r.password);
    const diag = window.__diagLines || [];

    let html = '';
    if (diag.length > 0) {
      html += '<div style="color:var(--warning);font-size:12px;margin-bottom:8px;padding:8px;background:var(--bg);border-radius:6px">';
      diag.forEach(d => { html += '<div>' + escHtml(d) + '</div>'; });
      html += '</div>';
    }

    if (!profiles || profiles.length === 0) {
      html += '<div class="empty"><p>No se encontraron planes</p></div>';
    } else {
      html += profiles.map(p => `
        <button class="profile-btn" onclick="openGenerate('${escAttr(p.name)}', '${escAttr(p.timelimit)}', '${escAttr(p.validez)}')">
          <strong>${escHtml(p.name)}</strong>
          <div class="sub">⏱ ${escHtml(p.timelimit)} &middot; Vence: ${escHtml(p.validez)}</div>
        </button>
      `).join('');
    }
    document.getElementById('profileList').innerHTML = html;
  } catch(e) {
    document.getElementById('profileList').innerHTML = `<div class="empty"><p>Error: ${escHtml(e.message || e)}</p><button class="btn btn-small btn-outline" style="margin-top:12px" onclick="openProfiles('${escAttr(routerId)}')">Reintentar</button></div>`;
  }
}

function getMockProfileButtons() {
  var mockProfiles = [
    {name:'1HORA', tl:'1h', val:'3 días'},
    {name:'2HORAS', tl:'2h', val:'3 días'},
    {name:'1DIA', tl:'1d', val:'3 días'},
    {name:'7DIAS', tl:'7d', val:'7 días'},
    {name:'15DIAS', tl:'15d', val:'15 días'},
    {name:'30DIAS', tl:'30d', val:'30 días'},
  ];
  return mockProfiles.map(p => `
    <button class="profile-btn" onclick="openGenerate('${escAttr(p.name)}', '${escAttr(p.tl)}', '${escAttr(p.val)}')" style="opacity:0.6">
      <strong>${escHtml(p.name)}</strong>
      <div class="sub">⏱ ${escHtml(p.tl)} &middot; Vence: ${escHtml(p.val)} (demo)</div>
    </button>
  `).join('');
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
    if (bridgeAvailable()) {
      await createUsers(ip, password, vouchers, profile, timelimit);
    }

    const pdfBytes = await generarPDF(vouchers, hotspotName, profile, validez);
    lastPdfData = { bytes: pdfBytes, filename: `vouchers_${profile}_${Date.now()}.pdf` };

    document.getElementById('genResult').style.display = 'block';
    document.getElementById('genVouchers').innerHTML = vouchers.map(v =>
      `<div class="voucher-item"><span class="v-user">${v.user}</span><span class="v-pass">${v.pass}</span></div>`
    ).join('');

    const styleCheck = document.querySelector('#voucherGridStyle');
    if (!styleCheck) {
      const s = document.createElement('style');
      s.id = 'voucherGridStyle';
      s.textContent = `
        .voucher-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px; }
        .voucher-item { background: var(--bg); border-radius: 8px; padding: 10px; text-align: center; }
        .voucher-item .v-user { display: block; font-size: 16px; font-weight: 700; letter-spacing: 2px; }
        .voucher-item .v-pass { display: block; font-size: 14px; color: var(--text2); margin-top: 2px; }
      `;
      document.head.appendChild(s);
    }
    toast(vouchers.length + ' vouchers generados!');
  } catch(e) {
    toast('Error: ' + (e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Generar';
  }
}

// ===== PDF Generation =====

async function generarPDF(vouchers, hotspotName, profile, validez) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pt = 2.83465;
  const PW = 102 * pt;
  const PH = 169 * pt;
  const VW = 60 * pt;
  const VH = 27 * pt;
  const MARGIN = (PW - VW) / 2;
  const GAP = 3 * pt;

  for (let i = 0; i < vouchers.length; i++) {
    const pos = i % 3;
    if (pos === 0) doc.addPage([PW, PH]);
    const page = doc.getPage(doc.getPageCount() - 1);
    const yStart = PH - (15 * pt) - pos * (VH + GAP);
    const v = vouchers[i];

    page.drawRectangle({ x: MARGIN, y: yStart - VH, width: VW, height: VH,
      borderColor: rgb(0,0,0), borderWidth: 1.5 });
    page.drawText(hotspotName, { x: MARGIN + 4*pt, y: yStart - 6*pt, size: 9,
      font: fontBold, color: rgb(0,0,0) });
    page.drawText('['+(i+1)+']', { x: MARGIN + VW - 14*pt, y: yStart - 6*pt, size: 7,
      font: font, color: rgb(0,0,0) });
    page.drawLine({ start: {x: MARGIN+4*pt, y: yStart-9*pt}, end: {x: MARGIN+VW-4*pt, y: yStart-9*pt},
      thickness: 0.5, color: rgb(0,0,0) });

    const labelY = yStart - 11.5*pt;
    const colW = (VW - 12*pt) / 2;
    page.drawText('Username', { x: MARGIN+4*pt, y: labelY, size: 5.5, font, color: rgb(0.3,0.3,0.3) });
    page.drawText('Password', { x: MARGIN+6*pt+colW, y: labelY, size: 5.5, font, color: rgb(0.3,0.3,0.3) });

    const credY = yStart - 17*pt;
    page.drawRectangle({ x: MARGIN+4*pt, y: credY, width: colW, height: 5.5*pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5 });
    page.drawText(v.user, { x: MARGIN+4*pt+2*pt, y: credY+1*pt, size: 10, font: fontBold, color: rgb(0,0,0) });
    page.drawRectangle({ x: MARGIN+6*pt+colW, y: credY, width: colW, height: 5.5*pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5 });
    page.drawText(v.pass, { x: MARGIN+8*pt+colW, y: credY+1*pt, size: 10, font: fontBold, color: rgb(0,0,0) });

    const footY = credY - 7*pt;
    page.drawRectangle({ x: MARGIN+4*pt, y: footY, width: VW-8*pt, height: 5*pt,
      borderColor: rgb(0,0,0), borderWidth: 0.5 });
    // Footer: plan: xxx (left) | validez: xxx (right) igual que Mikhmon
    page.drawText('plan: '+profile, { x: MARGIN+5*pt, y: footY+0.8*pt, size: 6.5,
      font: fontBold, color: rgb(0,0,0) });
    page.drawText('validez: '+validez, { x: MARGIN+VW-8*pt-10*validez.length, y: footY+0.8*pt, size: 6.5,
      font: fontBold, color: rgb(0,0,0) });
  }
  return await doc.save();
}

function downloadPDF() {
  if (!lastPdfData) return;
  const blob = new Blob([lastPdfData.bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = lastPdfData.filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function sharePDF() {
  if (!lastPdfData) return;
  
  // Try Android bridge share first
  if (typeof AndroidBridge !== 'undefined' && AndroidBridge.shareFile) {
    // Convert blob to base64
    var reader = new FileReader();
    reader.onload = function() {
      var base64 = reader.result.split(',')[1];
      AndroidBridge.shareFile(
        base64,
        lastPdfData.filename,
        'application/pdf'
      );
    };
    reader.readAsDataURL(new Blob([lastPdfData.bytes], {type:'application/pdf'}));
    return;
  }
  
  // Fallback: download
  downloadPDF();
  toast('PDF descargado - comparte desde Descargas');
}

// ===== Mock offline =====

function mockMikroTik(action, params) {
  if (action === 'profiles') {
    return [
      '1HORA,1h,3 d\u00edas',
      '2HORAS,2h,3 d\u00edas',
      '1DIA,1d,3 d\u00edas',
      '7DIAS,7d,7 d\u00edas',
      '15DIAS,15d,15 d\u00edas',
      '30DIAS,30d,30 d\u00edas',
    ].join('\n');
  }
  if (action === 'execute') return 'OK (demo)';
  return 'OK';
}

// ===== Inicializacion =====
(function init() {
  loadRouters();
  // Test bridge after 1s
  setTimeout(function() {
    if (bridgeAvailable()) {
      toast('✅ Conectado al MikroTik');
    } else {
      toast('⚠️ Modo demo - sin MikroTik');
    }
  }, 1500);
})();
