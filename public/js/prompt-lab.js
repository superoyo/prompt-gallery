/* ═══════════════════════════════════════════════════════════════
   prompt-lab.js  –  Prompt Lab (redesigned: prompt-first + sidebar)
   ═══════════════════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────────────────── */
const lab = {
  platforms:      [],   // all enabled platforms from API
  selectedSlug:   null, // currently selected platform slug
  selectedModel:  null, // currently selected model (null = use platform default)
  ratio:         '1:1',
  historyPage:    1,
  totalHistoryPages: 1,
  isGenerating:   false,
  menuOpen:       false,
};

/* ── Auth ───────────────────────────────────────────────────── */
function labToken()    { return localStorage.getItem('pg_token'); }
function labUsername() { return localStorage.getItem('pg_username'); }
function labIsAdmin()  { return localStorage.getItem('pg_is_admin') === 'true'; }
function labAuthHeaders() {
  const t = labToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* ── API helper ─────────────────────────────────────────────── */
async function labApi(method, path, body = null) {
  const opts = { method, headers: { ...labAuthHeaders() } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Toast ──────────────────────────────────────────────────── */
function labToast(msg, type = 'info') {
  if (typeof toast === 'function') { toast(msg, type); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer')?.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Escape HTML ────────────────────────────────────────────── */
function le(s) {
  if (typeof escHtml === 'function') return escHtml(s);
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Time ago ───────────────────────────────────────────────── */
function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)  return 'เมื่อกี้';
  if (diff < 3600) return `${Math.floor(diff/60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff/3600)} ชม.ที่แล้ว`;
  return `${Math.floor(diff/86400)} วันที่แล้ว`;
}

/* ── Token Estimate ─────────────────────────────────────────── */
function estimateTokens(text) {
  return Math.max(0, Math.round((text || '').trim().split(/\s+/).filter(Boolean).length * 1.33));
}

/* ══════════════════════════════════════════════════════════════
   PLATFORM DROPDOWN
   ══════════════════════════════════════════════════════════════ */
async function loadPlatforms() {
  try {
    // fetch only enabled platforms (is_enabled=1 with API key configured)
    const data = await fetch('/api/platforms').then(r => r.json());
    lab.platforms = Array.isArray(data) ? data : [];
    renderPlatformMenu();
    populateHistoryFilter();
  } catch (e) {
    document.getElementById('platformMenuList').innerHTML =
      `<div class="pm-loading">โหลดไม่ได้: ${le(e.message)}</div>`;
  }
}

/* ── แยก platform ที่พร้อมใช้จริง ──
   - มี API key (is_enabled=1, กรองมาจาก server แล้ว)
   - ถ้าเป็น google-imagen3: ต้องมี enabled_models อย่างน้อย 1 model
   - platform อื่น: แค่มี API key ก็พอ
*/
function isPlatformReady(p) {
  if (p.slug === 'google-imagen3') {
    return Array.isArray(p.enabled_models) && p.enabled_models.length > 0;
  }
  return true;
}

function renderPlatformMenu() {
  const list = document.getElementById('platformMenuList');
  const ready = lab.platforms.filter(isPlatformReady);

  if (!ready.length) {
    document.getElementById('noPlatformNotice').style.display = 'block';
    list.innerHTML = '<div class="pm-loading">ยังไม่มี AI platform ที่พร้อมใช้งาน</div>';
    return;
  }
  document.getElementById('noPlatformNotice').style.display = 'none';

  list.innerHTML = ready.map(p => `
    <div class="pm-item ${p.slug === lab.selectedSlug ? 'selected' : ''}"
         onclick="selectPlatform('${le(p.slug)}')">
      <span class="pm-icon">${le(p.icon || '🤖')}</span>
      <div class="pm-info">
        <div class="pm-name">${le(p.name)}</div>
        <div class="pm-desc">${le(p.description || '')}</div>
      </div>
      <div class="pm-right">
        <div class="pm-cost">$${(p.cost_per_gen || 0).toFixed(3)}/ภาพ</div>
        <div style="margin-top:3px"><span class="pm-badge-ok">✓ พร้อมใช้</span></div>
      </div>
    </div>
  `).join('');

  // auto-select first ready platform if none selected
  if (!lab.selectedSlug || !ready.find(p => p.slug === lab.selectedSlug)) {
    selectPlatform(ready[0].slug, false);
  }
}

function selectPlatform(slug, closeMenu = true) {
  const p = lab.platforms.find(pl => pl.slug === slug);
  if (!p) return;
  lab.selectedSlug = slug;
  lab.selectedModel = null;

  // update button
  document.getElementById('pdIcon').textContent = p.icon || '🤖';
  document.getElementById('pdName').textContent = p.name;
  document.getElementById('pdCost').textContent = `$${(p.cost_per_gen || 0).toFixed(3)}/ภาพ`;

  // highlight in menu
  document.querySelectorAll('.pm-item').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.pm-item').forEach(el => {
    if (el.querySelector('.pm-name')?.textContent === p.name) el.classList.add('selected');
  });

  // show model selector if platform has enabled_models
  renderModelSelector(p);

  if (closeMenu) closePlatformMenu();
  updateGenerateBtn();
}

function renderModelSelector(platform) {
  const group  = document.getElementById('modelSelectorGroup');
  const select = document.getElementById('modelSelect');
  if (!group || !select) return;

  const models = Array.isArray(platform.enabled_models) ? platform.enabled_models : [];
  if (!models.length) {
    group.style.display = 'none';
    lab.selectedModel = null;
    return;
  }

  // Populate options
  select.innerHTML = models.map(m =>
    `<option value="${le(m)}">${le(m)}</option>`
  ).join('');

  // Pre-select first model
  lab.selectedModel = models[0];
  select.value = models[0];
  group.style.display = '';
}

function togglePlatformMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('platformMenu');
  const btn  = document.getElementById('platformDropdownBtn');
  const arrow = document.getElementById('pdArrow');
  if (lab.menuOpen) {
    closePlatformMenu();
  } else {
    menu.style.display = 'block';
    btn.classList.add('open');
    arrow.classList.add('flipped');
    lab.menuOpen = true;
  }
}

function closePlatformMenu() {
  document.getElementById('platformMenu').style.display = 'none';
  document.getElementById('platformDropdownBtn').classList.remove('open');
  document.getElementById('pdArrow').classList.remove('flipped');
  lab.menuOpen = false;
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (lab.menuOpen && !document.getElementById('platformDropdown').contains(e.target)) {
    closePlatformMenu();
  }
});

/* ══════════════════════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════════════════════ */
function setRatio(btn) {
  document.querySelectorAll('.ratio-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  lab.ratio = btn.dataset.ratio;
}

function toggleNeg() {
  const area = document.getElementById('negArea');
  const icon = document.getElementById('negToggleIcon');
  const open = area.style.display === 'none';
  area.style.display = open ? 'block' : 'none';
  icon.textContent = open ? '－' : '＋';
  if (open) document.getElementById('negInput').focus();
}

function updateGenerateBtn() {
  const btn   = document.getElementById('generateBtn');
  const label = document.getElementById('genLabel');
  const prompt = (document.getElementById('promptInput')?.value || '').trim();
  const ready  = !!lab.selectedSlug && !!prompt && !lab.isGenerating;
  btn.disabled = !ready;

  if (lab.isGenerating) {
    label.textContent = 'กำลัง Generate...';
  } else if (!lab.selectedSlug) {
    label.textContent = '🎨 เลือก AI ก่อน';
  } else if (!prompt) {
    label.textContent = '🎨 ใส่ Prompt ก่อน';
  } else {
    const p = lab.platforms.find(pl => pl.slug === lab.selectedSlug);
    label.textContent = `🎨 Generate ด้วย ${p ? p.name : ''}`;
  }
}

/* ══════════════════════════════════════════════════════════════
   GENERATE
   ══════════════════════════════════════════════════════════════ */
async function generate() {
  if (lab.isGenerating) return;
  const prompt = (document.getElementById('promptInput').value || '').trim();
  const neg    = (document.getElementById('negInput')?.value  || '').trim();
  const quality = document.getElementById('qualitySelect').value;

  if (!prompt)          { labToast('กรุณาใส่ prompt', 'error'); return; }
  if (!lab.selectedSlug){ labToast('กรุณาเลือก AI platform', 'error'); return; }

  lab.isGenerating = true;
  updateGenerateBtn();

  // Show spinner in button
  document.getElementById('genSpinner').style.display = 'block';

  // Show loading state in result area
  const resultArea = document.getElementById('resultArea');
  const resultCard = document.getElementById('resultCard');
  resultArea.style.display = 'block';

  const platform = lab.platforms.find(p => p.slug === lab.selectedSlug);
  resultCard.innerHTML = `
    <div class="result-loading">
      <div class="spinner"></div>
      <div class="loading-platform">${le(platform?.icon || '🤖')} ${le(platform?.name || lab.selectedSlug)}</div>
      <div>กำลังสร้างภาพ...</div>
    </div>`;

  resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const body = {
      prompt,
      platforms: [lab.selectedSlug],
      negative_prompt: neg,
      size: lab.ratio,
      quality,
    };
    if (lab.selectedModel) body.model = lab.selectedModel;
    const res = await labApi('POST', '/api/lab/generate', body);

    const result = res.results?.[0];
    if (!result) throw new Error('ไม่ได้รับผลลัพธ์จาก server');

    renderResult(result, prompt);
    loadHistory(1);
    loadSidebarStats();
  } catch (e) {
    resultCard.innerHTML = `
      <div class="result-error">
        <div class="result-error-icon">❌</div>
        <div class="result-error-title">Generate ล้มเหลว</div>
        <div class="result-error-msg">${le(e.message)}</div>
      </div>`;
    labToast(e.message, 'error');
  } finally {
    lab.isGenerating = false;
    document.getElementById('genSpinner').style.display = 'none';
    updateGenerateBtn();
  }
}

function renderResult(result, prompt) {
  const card = document.getElementById('resultCard');
  const p    = lab.platforms.find(pl => pl.slug === result.slug) || {};

  if (result.status === 'error') {
    card.innerHTML = `
      <div class="result-error">
        <div class="result-error-icon">❌</div>
        <div class="result-error-title">${le(result.name || result.slug)}</div>
        <div class="result-error-msg">${le(result.error)}</div>
      </div>`;
    return;
  }

  const imgPath = result.image_path || '';
  const tokens  = result.tokens_used || 0;
  const cost    = result.cost_usd    || 0;

  card.innerHTML = `
    <div class="result-success">
      <div class="result-img-wrap" onclick="openLightbox('${le(imgPath)}', '${le(result.name || '')}')">
        <img class="result-img" src="${le(imgPath)}" alt="${le(result.name)}" />
      </div>
      <div class="result-footer">
        <div class="result-platform">
          <span class="result-platform-icon">${le(p.icon || result.icon || '🤖')}</span>
          <span class="result-platform-name">${le(result.name)}</span>
        </div>
        <div class="result-meta-chips">
          ${tokens ? `<span class="result-chip result-chip-token">🔢 ${tokens} tokens</span>` : ''}
          ${cost   ? `<span class="result-chip result-chip-cost">💰 $${cost.toFixed(4)}</span>` : ''}
        </div>
        <div class="result-actions">
          <button class="result-btn" onclick="downloadImage('${le(imgPath)}')">⬇️ ดาวน์โหลด</button>
          <button class="result-btn" onclick="reusePrompt(${JSON.stringify(le(prompt))})">🔄 ใช้อีกครั้ง</button>
        </div>
      </div>
    </div>`;
}

function downloadImage(src) {
  const a = document.createElement('a');
  a.href = src;
  a.download = `prompt-lab-${Date.now()}.webp`;
  a.click();
}

function reusePrompt(prompt) {
  document.getElementById('promptInput').value = prompt;
  document.getElementById('promptInput').focus();
  updateGenerateBtn();
  updateTokenBadge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════════════
   LIGHTBOX
   ══════════════════════════════════════════════════════════════ */
function openLightbox(src, name) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxMeta').textContent = name || '';
  document.getElementById('lightbox').hidden = false;
}
function closeLightbox() { document.getElementById('lightbox').hidden = true; }
document.getElementById('lightbox')?.addEventListener('click', function(e) {
  if (e.target === this) closeLightbox();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

/* ══════════════════════════════════════════════════════════════
   HISTORY SIDEBAR
   ══════════════════════════════════════════════════════════════ */
function populateHistoryFilter() {
  const sel = document.getElementById('historyFilter');
  if (!sel) return;
  // keep the first "ทุก platform" option, remove the rest
  while (sel.options.length > 1) sel.remove(1);
  lab.platforms.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.slug;
    opt.textContent = `${p.icon || ''} ${p.name}`;
    sel.appendChild(opt);
  });
}

async function loadHistory(page = 1) {
  lab.historyPage = page;
  const filter = document.getElementById('historyFilter')?.value || '';
  const feed   = document.getElementById('historyFeed');
  feed.innerHTML = '<div class="sidebar-loading">กำลังโหลด...</div>';

  try {
    let url = `/api/lab/history?page=${page}`;
    if (filter) url += `&platform=${encodeURIComponent(filter)}`;
    const data = await labApi('GET', url);
    lab.totalHistoryPages = data.pages || 1;
    renderHistoryFeed(data.history || []);
    renderHistoryPagination(page, data.pages || 1);
  } catch (e) {
    feed.innerHTML = `<div class="sidebar-empty">โหลดไม่ได้: ${le(e.message)}</div>`;
  }
}

function renderHistoryFeed(items) {
  const feed = document.getElementById('historyFeed');
  if (!items.length) {
    feed.innerHTML = '<div class="sidebar-empty">ยังไม่มีประวัติ</div>';
    return;
  }
  feed.innerHTML = items.map(item => {
    const p = lab.platforms.find(pl => pl.slug === item.platform_slug);
    const icon = p?.icon || '🤖';
    const isOk = item.status === 'success';

    const thumb = (isOk && item.result_image_path)
      ? `<img class="hi-thumb" src="/uploads/${le(item.result_image_path)}"
              alt="" onclick="openLightbox('/uploads/${le(item.result_image_path)}', '${le(item.platform_name)}')" />`
      : `<div class="hi-thumb-placeholder" title="${le(item.error_msg || '')}">${isOk ? icon : '❌'}</div>`;

    const promptShort = (item.prompt_text || '').slice(0, 80) + (item.prompt_text?.length > 80 ? '…' : '');

    return `
      <div class="history-item">
        ${thumb}
        <div class="hi-body">
          <div class="hi-platform">
            <span class="hi-platform-icon">${icon}</span>
            <span class="hi-platform-name ${isOk ? '' : 'hi-status-fail'}">${le(item.platform_name)}</span>
          </div>
          <div class="hi-prompt">${le(promptShort)}</div>
          <div class="hi-meta">
            ${item.tokens_used ? `<span class="hi-token">🔢 ${item.tokens_used}</span>` : ''}
            ${item.cost_usd ? `<span>$${(item.cost_usd).toFixed(4)}</span>` : ''}
            <span>${timeAgo(item.created_at)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderHistoryPagination(current, total) {
  const el = document.getElementById('historyPagination');
  if (!el || total <= 1) { el && (el.innerHTML = ''); return; }
  let html = `<button class="sp-btn" onclick="loadHistory(${current-1})" ${current<=1?'disabled':''}>‹</button>`;
  for (let p = 1; p <= Math.min(total, 7); p++) {
    html += `<button class="sp-btn ${p===current?'active':''}" onclick="loadHistory(${p})">${p}</button>`;
  }
  html += `<button class="sp-btn" onclick="loadHistory(${current+1})" ${current>=total?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   SIDEBAR STATS
   ══════════════════════════════════════════════════════════════ */
async function loadSidebarStats() {
  try {
    const stats = await labApi('GET', '/api/lab/stats');
    renderSidebarStats(stats);
  } catch { /* silent */ }
}

function renderSidebarStats(stats) {
  const el = document.getElementById('sidebarStats');
  if (!el || !stats.length) return;
  el.innerHTML = stats.slice(0, 5).map(s => {
    const p = lab.platforms.find(pl => pl.slug === s.platform_slug);
    return `
      <div class="stat-chip">
        <div class="stat-chip-left">
          <span class="stat-chip-icon">${p?.icon || '🤖'}</span>
          <span class="stat-chip-name">${le(s.platform_name)}</span>
        </div>
        <div class="stat-chip-right">
          <div class="stat-chip-gens">${s.success_gens || 0} gens</div>
          <div class="stat-chip-cost">$${(s.total_cost || 0).toFixed(3)}</div>
        </div>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   AUTH AREA  (reuse app.js if available)
   ══════════════════════════════════════════════════════════════ */
function labRenderAuthArea() {
  if (typeof renderAuthArea === 'function') {
    renderAuthArea();
    return;
  }
  const area = document.getElementById('authArea');
  if (!area) return;
  const username = labUsername();
  if (username) {
    area.innerHTML = `
      <span style="font-size:.85rem;font-weight:600;color:#334155">👤 ${le(username)}</span>
      ${labIsAdmin() ? `<a href="/admin" style="font-size:.82rem;color:#2563eb;font-weight:600;margin-left:8px">⚙ Admin</a>` : ''}
      <button onclick="labLogout()" style="margin-left:8px;padding:6px 14px;border-radius:99px;border:1.5px solid #e2e8f0;background:white;color:#64748b;font-size:.8rem;cursor:pointer;font-family:inherit">ออก</button>`;
  } else {
    area.innerHTML = `<button onclick="window.location.href='/'" class="nav-pill" style="font-size:.82rem;padding:6px 16px">เข้าสู่ระบบ</button>`;
  }
}
function labLogout() {
  ['pg_token','pg_username','pg_is_admin'].forEach(k => localStorage.removeItem(k));
  window.location.href = '/';
}

/* ══════════════════════════════════════════════════════════════
   TOKEN BADGE LIVE UPDATE
   ══════════════════════════════════════════════════════════════ */
function updateTokenBadge() {
  const text = (document.getElementById('promptInput')?.value || '') +
               ' ' + (document.getElementById('negInput')?.value || '');
  const t = estimateTokens(text.trim());
  const badge = document.getElementById('tokenBadge');
  if (badge) badge.textContent = `~${t} tokens`;
}

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  labRenderAuthArea();

  if (!labToken()) {
    document.getElementById('loginGate').style.display = 'flex';
    document.getElementById('labLayout').style.display = 'none';
    return;
  }

  document.getElementById('loginGate').style.display  = 'none';
  document.getElementById('labLayout').style.display  = 'grid';

  // Prompt input events
  const promptInput = document.getElementById('promptInput');
  promptInput?.addEventListener('input', () => {
    updateTokenBadge();
    updateGenerateBtn();
  });
  document.getElementById('negInput')?.addEventListener('input', updateTokenBadge);
  document.getElementById('qualitySelect')?.addEventListener('change', updateGenerateBtn);

  // Load data
  await loadPlatforms();
  loadHistory(1);
  loadSidebarStats();
  updateGenerateBtn();
  updateTokenBadge();
});
