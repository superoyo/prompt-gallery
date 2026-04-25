/* ── Safe JSON (Safari-compatible) ─────────────────────────────── */
async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { return { ok: false, error: `Server error (HTTP ${res.status}): ${text.slice(0,300)}` }; }
}

/* ── State ──────────────────────────────────────────────────────── */
const A = {
  // ใช้ token เดียวกับหน้าหลัก
  token:    localStorage.getItem('pg_token'),
  username: localStorage.getItem('pg_username'),
  isAdmin:  localStorage.getItem('pg_is_admin') === 'true',
  page:     'dashboard',
  resetUserId: null,
  usersPage: 1, promptsPage: 1, logsPage: 1,
  logsFilter: 'all',
  userSearchTimer: null, promptSearchTimer: null,
};

/* ── API ────────────────────────────────────────────────────────── */
async function api(method, path, body = null) {
  const opts = { method, headers: {} };
  if (A.token) opts.headers['Authorization'] = `Bearer ${A.token}`;
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res  = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Logout ─────────────────────────────────────────────────────── */
function adminLogout() {
  localStorage.removeItem('pg_token');
  localStorage.removeItem('pg_username');
  localStorage.removeItem('pg_is_admin');
  window.location.href = '/';
}

/* ── Navigation ─────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

function navigateTo(page) {
  A.page = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  else if (page === 'users')     loadUsers(1);
  else if (page === 'prompts')   loadPrompts(1);
  else if (page === 'categories') loadCategories();
  else if (page === 'platforms') loadPlatforms();
  else if (page === 'logs')      loadLogs(1);
  else if (page === 'settings-apikeys') loadSettingsApiKeys();
  else if (page === 'settings-tests')   { /* static page */ }
  else if (page === 'test-google')      gt2_loadPlatformInfo();
}

/* ── Dashboard ──────────────────────────────────────────────────── */
async function loadDashboard() {
  try {
    const stats = await api('GET', '/api/admin/stats');
    renderStats(stats);
    const logs = await api('GET', '/api/admin/logs?page=1');
    renderRecentLogs(logs.logs.slice(0, 8));
  } catch (e) { toast(e.message, 'error'); }
}

function renderStats(s) {
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-icon blue">👥</div><div class="stat-num">${s.total_users}</div><div class="stat-label">ผู้ใช้ทั้งหมด</div></div>
    <div class="stat-card"><div class="stat-icon green">✦</div><div class="stat-num">${s.total_prompts}</div><div class="stat-label">Prompts ทั้งหมด</div></div>
    <div class="stat-card"><div class="stat-icon blue">🔑</div><div class="stat-num">${s.today_logins}</div><div class="stat-label">Login วันนี้</div></div>
    <div class="stat-card"><div class="stat-icon red">⚠️</div><div class="stat-num">${s.failed_today}</div><div class="stat-label">Login ล้มเหลววันนี้</div></div>
    <div class="stat-card"><div class="stat-icon orange">🔒</div><div class="stat-num">${s.disabled_users}</div><div class="stat-label">บัญชีถูกระงับ</div></div>
    <div class="stat-card"><div class="stat-icon blue">📋</div><div class="stat-num">${s.total_logs}</div><div class="stat-label">Log ทั้งหมด</div></div>
  `;
}

function renderRecentLogs(logs) {
  const el = document.getElementById('recentLogs');
  if (!logs.length) { el.innerHTML = '<p style="color:var(--text-3);font-size:.85rem">ยังไม่มี log</p>'; return; }
  el.innerHTML = `<div class="log-list">${logs.map(l => `
    <div class="log-item">
      <div class="log-dot ${l.success ? 'success' : 'failed'}"></div>
      <div class="log-user">${esc(l.username)}</div>
      <div class="log-ip">${esc(l.ip || '-')}</div>
      <span class="badge ${l.success ? 'badge-success' : 'badge-failed'}">${l.success ? 'สำเร็จ' : 'ล้มเหลว'}</span>
      <div class="log-time">${fmt(l.created_at)}</div>
    </div>`).join('')}
  </div>`;
}

/* ── Users ──────────────────────────────────────────────────────── */
async function loadUsers(page = 1) {
  A.usersPage = page;
  const search = document.getElementById('userSearch')?.value.trim() || '';
  try {
    const data = await api('GET', `/api/admin/users?page=${page}&search=${encodeURIComponent(search)}`);
    renderUsersTable(data.users);
    renderPagination('usersPagination', data.page, data.pages, loadUsers);
  } catch (e) { toast(e.message, 'error'); }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:40px">ไม่พบผู้ใช้</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-avatar">${esc(u.username[0].toUpperCase())}</div>
          <div>
            <div class="user-name">${esc(u.username)}</div>
            <div class="user-role">${u.is_admin ? '👑 Admin' : 'User'}</div>
          </div>
        </div>
      </td>
      <td style="color:var(--text-2)">${esc(u.email || '-')}</td>
      <td><span style="font-weight:600">${u.prompt_count || 0}</span></td>
      <td style="color:var(--text-2);white-space:nowrap">${fmt(u.created_at)}</td>
      <td style="color:var(--text-2);white-space:nowrap">${u.last_login_at ? fmt(u.last_login_at) : '-'}</td>
      <td>
        <span class="badge ${u.is_disabled ? 'badge-disabled' : 'badge-active'}">
          ${u.is_disabled ? 'ระงับ' : 'ปกติ'}
        </span>
      </td>
      <td>
        <div class="action-group">
          <button class="btn-sm ${u.is_disabled ? 'btn-sm-green' : 'btn-sm-warning'}"
                  onclick="toggleDisable(${u.id}, ${u.is_disabled})">
            ${u.is_disabled ? '✓ เปิดใช้' : '⛔ ระงับ'}
          </button>
          <button class="btn-sm btn-sm-primary" onclick="openResetModal(${u.id}, '${esc(u.username)}')">
            🔑 Reset PW
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.getElementById('userSearch')?.addEventListener('input', () => {
  clearTimeout(A.userSearchTimer);
  A.userSearchTimer = setTimeout(() => loadUsers(1), 400);
});

async function toggleDisable(userId, currentState) {
  const action = currentState ? 'เปิดใช้งาน' : 'ระงับ';
  if (!confirm(`ยืนยันการ${action}บัญชีนี้?`)) return;
  try {
    await api('PATCH', `/api/admin/users/${userId}/toggle-disable`);
    toast(`${action}บัญชีสำเร็จ`, 'success');
    loadUsers(A.usersPage);
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Reset Password Modal ────────────────────────────────────────── */
function openResetModal(userId, username) {
  A.resetUserId = userId;
  document.getElementById('resetUsername').textContent = username;
  document.getElementById('resetPwInput').value = '';
  document.getElementById('resetResult').classList.add('hidden');
  openModal('resetModal');
}

async function confirmReset() {
  const newPw = document.getElementById('resetPwInput').value.trim();
  try {
    const res = await api('POST', `/api/admin/users/${A.resetUserId}/reset-password`,
      newPw ? { new_password: newPw } : {}
    );
    document.getElementById('resultPw').textContent = res.new_password;
    document.getElementById('resetResult').classList.remove('hidden');
    toast('Reset password สำเร็จ', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function copyNewPw() {
  const pw = document.getElementById('resultPw').textContent;
  navigator.clipboard.writeText(pw).then(() => toast('คัดลอกแล้ว!', 'success'));
}

/* ── Prompts ─────────────────────────────────────────────────────── */
async function loadPrompts(page = 1) {
  A.promptsPage = page;
  const search = document.getElementById('promptSearch')?.value.trim() || '';
  try {
    const data = await api('GET', `/api/admin/prompts?page=${page}&search=${encodeURIComponent(search)}`);
    renderPromptsTable(data.prompts);
    renderPagination('promptsPagination', data.page, data.pages, loadPrompts);
  } catch (e) { toast(e.message, 'error'); }
}

function renderPromptsTable(prompts) {
  const tbody = document.getElementById('promptsTbody');
  if (!prompts.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:40px">ไม่พบ prompt</td></tr>';
    return;
  }
  tbody.innerHTML = prompts.map(p => `
    <tr>
      <td>
        ${p.image_path
          ? `<img class="thumb-img" src="/uploads/${esc(p.image_path)}" alt="">`
          : `<div class="thumb-placeholder">-</div>`}
      </td>
      <td>
        <div style="font-weight:600;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px">${esc((p.prompt_text || '').slice(0, 80))}…</div>
      </td>
      <td><span class="badge badge-admin">${esc(p.category)}</span></td>
      <td style="font-weight:500">${esc(p.username)}</td>
      <td style="color:var(--text-2);white-space:nowrap">${fmt(p.created_at)}</td>
      <td>
        <button class="btn-sm btn-sm-danger" onclick="adminDeletePrompt(${p.id})">🗑 ลบ</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('promptSearch')?.addEventListener('input', () => {
  clearTimeout(A.promptSearchTimer);
  A.promptSearchTimer = setTimeout(() => loadPrompts(1), 400);
});

async function adminDeletePrompt(id) {
  if (!confirm('ยืนยันการลบ prompt นี้?')) return;
  try {
    await api('DELETE', `/api/prompts/${id}`);
    toast('ลบ prompt สำเร็จ', 'success');
    loadPrompts(A.promptsPage);
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Categories ─────────────────────────────────────────────────── */
let catEditId = null;

async function loadCategories() {
  try {
    const cats = await api('GET', '/api/admin/categories');
    renderCategoriesTable(cats);
  } catch (e) { toast(e.message, 'error'); }
}

function renderCategoriesTable(cats) {
  const tbody = document.getElementById('categoryTbody');
  if (!cats.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:40px">ยังไม่มีหมวดหมู่</td></tr>';
    return;
  }
  tbody.innerHTML = cats.map((c, idx) => `
    <tr id="cat-row-${c.id}">
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn-sm btn-sm-primary" style="padding:3px 7px;font-size:.7rem" title="เลื่อนขึ้น"
            onclick="moveCat(${c.id}, ${c.sort_order}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn-sm btn-sm-primary" style="padding:3px 7px;font-size:.7rem" title="เลื่อนลง"
            onclick="moveCat(${c.id}, ${c.sort_order}, 1)" ${idx === cats.length-1 ? 'disabled' : ''}>▼</button>
          <span style="color:var(--text-3);font-size:.75rem;width:24px;text-align:center">${idx+1}</span>
        </div>
      </td>
      <td>
        <span style="font-weight:600">${esc(c.name)}</span>
      </td>
      <td>
        <span class="badge ${c.prompt_count > 0 ? 'badge-active' : ''}" style="${c.prompt_count === 0 ? 'background:#f8faff;color:var(--text-3);border-color:var(--border)' : ''}">
          ${c.prompt_count} prompts
        </span>
      </td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" ${c.is_visible ? 'checked' : ''}
                 onchange="toggleCatVisible(${c.id}, this)" />
          <div class="toggle-track"></div>
          <span class="toggle-label">${c.is_visible ? 'แสดง' : 'ซ่อน'}</span>
        </label>
      </td>
      <td>
        <div class="action-group">
          <button class="btn-sm btn-sm-primary" onclick="openEditCategoryModal(${c.id}, '${esc(c.name)}')">✏️ แก้ไข</button>
          <button class="btn-sm btn-sm-danger" onclick="deleteCategory(${c.id}, '${esc(c.name)}', ${c.prompt_count})"
            ${c.prompt_count > 0 ? 'disabled title="มี prompt ใช้อยู่ ลบไม่ได้"' : ''}>🗑 ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openAddCategoryModal() {
  catEditId = null;
  document.getElementById('catFormTitle').textContent = 'เพิ่มหมวดหมู่ใหม่';
  document.getElementById('catNameInput').value = '';
  document.getElementById('catFormError').textContent = '';
  document.getElementById('catFormCard').style.display = 'block';
  document.getElementById('catNameInput').focus();
}

function openEditCategoryModal(id, name) {
  catEditId = id;
  document.getElementById('catFormTitle').textContent = 'แก้ไขหมวดหมู่';
  document.getElementById('catNameInput').value = name;
  document.getElementById('catFormError').textContent = '';
  document.getElementById('catFormCard').style.display = 'block';
  document.getElementById('catNameInput').focus();
}

function closeCatForm() {
  document.getElementById('catFormCard').style.display = 'none';
  catEditId = null;
}

async function saveCategoryForm() {
  const name = document.getElementById('catNameInput').value.trim();
  const errEl = document.getElementById('catFormError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'กรุณากรอกชื่อ'; return; }
  try {
    if (catEditId) {
      await api('PATCH', `/api/admin/categories/${catEditId}`, { name });
      toast('แก้ไขหมวดหมู่สำเร็จ', 'success');
    } else {
      await api('POST', '/api/admin/categories', { name });
      toast('เพิ่มหมวดหมู่สำเร็จ', 'success');
    }
    closeCatForm();
    loadCategories();
  } catch (e) { errEl.textContent = e.message; }
}

// Enter key submit
document.getElementById('catNameInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCategoryForm();
});

async function toggleCatVisible(id, checkbox) {
  const label = checkbox.closest('.toggle-switch').querySelector('.toggle-label');
  try {
    const res = await api('PATCH', `/api/admin/categories/${id}/toggle-visible`);
    label.textContent = res.is_visible ? 'แสดง' : 'ซ่อน';
    toast(res.is_visible ? 'แสดงหมวดหมู่แล้ว' : 'ซ่อนหมวดหมู่แล้ว', 'success');
  } catch (e) {
    checkbox.checked = !checkbox.checked; // revert
    toast(e.message, 'error');
  }
}

async function deleteCategory(id, name, promptCount) {
  if (promptCount > 0) { toast('มี prompt ใช้อยู่ ลบไม่ได้', 'error'); return; }
  if (!confirm(`ลบหมวดหมู่ "${name}" ?`)) return;
  try {
    await api('DELETE', `/api/admin/categories/${id}`);
    toast('ลบหมวดหมู่สำเร็จ', 'success');
    loadCategories();
  } catch (e) { toast(e.message, 'error'); }
}

// ย้ายลำดับ: โหลดใหม่ทั้งหมดแล้ว reorder
let _catCache = [];
async function moveCat(id, currentOrder, dir) {
  try {
    const cats = await api('GET', '/api/admin/categories');
    const idx  = cats.findIndex(c => c.id === id);
    const target = idx + dir;
    if (target < 0 || target >= cats.length) return;

    // swap sort_order
    const reorder = cats.map((c, i) => ({ id: c.id, sort_order: i }));
    const tmp = reorder[idx].sort_order;
    reorder[idx].sort_order   = reorder[target].sort_order;
    reorder[target].sort_order = tmp;

    await api('POST', '/api/admin/categories/reorder', reorder);
    loadCategories();
  } catch (e) { toast(e.message, 'error'); }
}

/* ── AI Platforms ────────────────────────────────────────────────── */
let _platformEditId = null;
let _apikeyPlatformId = null;
let _platformUsageMap = {};

async function loadPlatforms() {
  try {
    const [platforms, usage] = await Promise.all([
      api('GET', '/api/admin/platforms'),
      api('GET', '/api/admin/lab/stats').catch(() => [])
    ]);
    // Build usage map by slug
    _platformUsageMap = {};
    (Array.isArray(usage) ? usage : []).forEach(u => {
      _platformUsageMap[u.platform_slug] = u;
    });
    renderPlatformsTable(platforms);
    renderPlatformStats(usage);
  } catch (e) { toast(e.message, 'error'); }
}

function renderPlatformStats(usage) {
  const el = document.getElementById('platformStatsGrid');
  if (!el) return;
  const totalGens  = usage.reduce((s, u) => s + (u.total_gens  || 0), 0);
  const totalCost  = usage.reduce((s, u) => s + (u.total_cost  || 0), 0);
  const totalTokens = usage.reduce((s, u) => s + (u.total_tokens || 0), 0);
  const platforms  = document.querySelectorAll('#platformTbody tr').length;
  el.innerHTML = `
    <div class="stat-card"><div class="stat-icon blue">🤖</div><div class="stat-num" id="pfStatCount">-</div><div class="stat-label">Platform ทั้งหมด</div></div>
    <div class="stat-card"><div class="stat-icon green">🎨</div><div class="stat-num">${totalGens.toLocaleString()}</div><div class="stat-label">Generations ทั้งหมด</div></div>
    <div class="stat-card"><div class="stat-icon blue">🔢</div><div class="stat-num">${totalTokens.toLocaleString()}</div><div class="stat-label">Tokens ที่ใช้</div></div>
    <div class="stat-card"><div class="stat-icon orange">💰</div><div class="stat-num">$${totalCost.toFixed(2)}</div><div class="stat-label">ต้นทุนรวม (USD)</div></div>
  `;
}

function renderPlatformsTable(platforms) {
  // update platform count stat
  setTimeout(() => {
    const el = document.getElementById('pfStatCount');
    if (el) el.textContent = platforms.length;
  }, 50);

  const tbody = document.getElementById('platformTbody');
  if (!platforms.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:40px">ยังไม่มี Platform</td></tr>';
    return;
  }
  tbody.innerHTML = platforms.map(p => {
    const u = _platformUsageMap[p.slug] || {};
    const enabled = p.is_enabled;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.4rem">${esc(p.icon||'🤖')}</span>
          <div>
            <div style="font-weight:600">${esc(p.name)}</div>
            <div style="font-size:.75rem;color:var(--text-3)">${esc(p.description||'').slice(0,50)}</div>
          </div>
        </div>
      </td>
      <td><code style="font-size:.75rem;background:var(--bg-3);padding:2px 6px;border-radius:4px">${esc(p.slug)}</code></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge ${enabled ? 'badge-success' : 'badge-disabled'}">
            ${enabled ? '✓ ตั้งค่าแล้ว' : '✗ ยังไม่มี Key'}
          </span>
          ${p.api_key_masked ? `<code style="font-size:.72rem;color:var(--text-3)">${esc(p.api_key_masked)}</code>` : ''}
        </div>
      </td>
      <td style="font-size:.85rem;color:var(--text-2)">$${(p.cost_per_gen||0).toFixed(3)}</td>
      <td style="font-size:.82rem">
        ${u.total_gens ? `
          <span style="font-weight:600">${u.total_gens}</span>
          <span style="color:var(--text-3);font-size:.75rem"> / ${u.success_gens||0} ✓</span>
          <div style="font-size:.72rem;color:var(--text-3)">$${(u.total_cost||0).toFixed(3)} | ${(u.total_tokens||0).toLocaleString()} tokens</div>
        ` : '<span style="color:var(--text-3);font-size:.8rem">-</span>'}
      </td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" ${p.is_visible ? 'checked' : ''} onchange="togglePlatformVisible(${p.id}, this)" />
          <div class="toggle-track"></div>
          <span class="toggle-label">${p.is_visible ? 'แสดง' : 'ซ่อน'}</span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-action btn-key" onclick="openApikeyPanel(${p.id}, '${esc(p.name)}')">🔑 API Key</button>
          <button class="btn-action btn-docs" onclick="showDocs(${p.id})">📖 คู่มือ</button>
          <button class="btn-action btn-edit" onclick="openEditPlatformForm(${p.id})">✏️</button>
          <button class="btn-action btn-del" onclick="deletePlatform(${p.id}, '${esc(p.name)}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* Add / Edit Platform Form */
function openAddPlatformForm() {
  _platformEditId = null;
  document.getElementById('platformFormTitle').textContent = 'เพิ่ม Platform ใหม่';
  document.getElementById('pfName').value  = '';
  document.getElementById('pfSlug').value  = '';
  document.getElementById('pfIcon').value  = '🤖';
  document.getElementById('pfCost').value  = '0.04';
  document.getElementById('pfDesc').value  = '';
  document.getElementById('pfFormError').textContent = '';
  document.getElementById('platformFormCard').style.display = 'block';
  // Auto-generate slug from name
  document.getElementById('pfName').oninput = () => {
    if (!_platformEditId) {
      document.getElementById('pfSlug').value =
        document.getElementById('pfName').value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
  };
  document.getElementById('pfName').focus();
}

async function openEditPlatformForm(id) {
  try {
    const platforms = await api('GET', '/api/admin/platforms');
    const p = platforms.find(pl => pl.id === id);
    if (!p) return;
    _platformEditId = id;
    document.getElementById('platformFormTitle').textContent = 'แก้ไข Platform';
    document.getElementById('pfName').value = p.name;
    document.getElementById('pfSlug').value = p.slug;
    document.getElementById('pfIcon').value = p.icon || '🤖';
    document.getElementById('pfCost').value = p.cost_per_gen || 0;
    document.getElementById('pfDesc').value = p.description || '';
    document.getElementById('pfFormError').textContent = '';
    document.getElementById('platformFormCard').style.display = 'block';
    document.getElementById('pfName').oninput = null;
    document.getElementById('pfName').focus();
  } catch (e) { toast(e.message, 'error'); }
}

function closePlatformForm() {
  document.getElementById('platformFormCard').style.display = 'none';
  _platformEditId = null;
}

async function savePlatformForm() {
  const errEl = document.getElementById('pfFormError');
  errEl.textContent = '';
  const name = document.getElementById('pfName').value.trim();
  const slug = document.getElementById('pfSlug').value.trim();
  if (!name || !slug) { errEl.textContent = 'กรุณากรอก Name และ Slug'; return; }
  const body = {
    name, slug,
    icon: document.getElementById('pfIcon').value.trim() || '🤖',
    cost_per_gen: parseFloat(document.getElementById('pfCost').value) || 0,
    description: document.getElementById('pfDesc').value.trim(),
  };
  try {
    if (_platformEditId) {
      await api('PATCH', `/api/admin/platforms/${_platformEditId}`, body);
      toast('แก้ไข Platform สำเร็จ', 'success');
    } else {
      await api('POST', '/api/admin/platforms', body);
      toast('เพิ่ม Platform สำเร็จ', 'success');
    }
    closePlatformForm();
    loadPlatforms();
  } catch (e) { errEl.textContent = e.message; }
}

/* API Key Panel */
function openApikeyPanel(id, name) {
  _apikeyPlatformId = id;
  document.getElementById('apikeyPlatformName').textContent = name;
  document.getElementById('apikeyInput').value  = '';
  document.getElementById('apikeyInput').type   = 'password';
  document.getElementById('apikeyModel').value  = '';
  document.getElementById('apikeyExtra').value  = '{}';
  document.getElementById('apikeyError').textContent = '';
  document.getElementById('apikeyPanel').style.display = 'block';
  document.getElementById('apikeyInput').focus();
  // scroll into view
  document.getElementById('apikeyPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeApikeyPanel() {
  document.getElementById('apikeyPanel').style.display = 'none';
  _apikeyPlatformId = null;
}

function toggleApikeyVisibility() {
  const inp = document.getElementById('apikeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveApiKey() {
  const errEl = document.getElementById('apikeyError');
  errEl.textContent = '';
  const api_key     = document.getElementById('apikeyInput').value.trim();
  const model       = document.getElementById('apikeyModel').value.trim();
  const extra_raw   = document.getElementById('apikeyExtra').value.trim();
  try {
    JSON.parse(extra_raw || '{}');
  } catch { errEl.textContent = 'Extra Config ต้องเป็น JSON ที่ถูกต้อง'; return; }
  const body = { api_key };
  if (model) body.model = model;
  if (extra_raw) body.extra_config = extra_raw;
  try {
    await api('PATCH', `/api/admin/platforms/${_apikeyPlatformId}`, body);
    toast(api_key ? 'บันทึก API Key สำเร็จ ✓' : 'ลบ API Key สำเร็จ', 'success');
    closeApikeyPanel();
    loadPlatforms();
  } catch (e) { errEl.textContent = e.message; }
}

/* Docs Guide Panel */
async function showDocs(id) {
  try {
    const platforms = await api('GET', '/api/admin/platforms');
    const p = platforms.find(pl => pl.id === id);
    if (!p) return;
    document.getElementById('docsPanelTitle').textContent = `📖 ${p.name} — คู่มือการเชื่อมต่อ`;
    const guide = p.docs_guide || '_ยังไม่มีคู่มือสำหรับ platform นี้_';
    document.getElementById('docsPanelBody').innerHTML = mdToHtml(guide);
    document.getElementById('docsPanel').style.display = 'block';
    document.getElementById('docsPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { toast(e.message, 'error'); }
}

function closeDocsPanel() {
  document.getElementById('docsPanel').style.display = 'none';
}

/* Simple markdown → HTML (h2, h3, bold, code, lists, paragraphs) */
function mdToHtml(md) {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}

/* Toggle Visible */
async function togglePlatformVisible(id, checkbox) {
  const label = checkbox.closest('.toggle-switch').querySelector('.toggle-label');
  try {
    const res = await api('PATCH', `/api/admin/platforms/${id}/toggle-visible`);
    label.textContent = res.is_visible ? 'แสดง' : 'ซ่อน';
    toast(res.is_visible ? 'แสดง Platform แล้ว' : 'ซ่อน Platform แล้ว', 'success');
  } catch (e) {
    checkbox.checked = !checkbox.checked;
    toast(e.message, 'error');
  }
}

/* Delete Platform */
async function deletePlatform(id, name) {
  if (!confirm(`ลบ platform "${name}" ? การ generate ที่ผ่านมาจะยังคงอยู่ในประวัติ`)) return;
  try {
    await api('DELETE', `/api/admin/platforms/${id}`);
    toast('ลบ Platform สำเร็จ', 'success');
    loadPlatforms();
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Logs ────────────────────────────────────────────────────────── */
async function loadLogs(page = 1) {
  A.logsPage = page;
  try {
    const data = await api('GET', `/api/admin/logs?page=${page}&filter=${A.logsFilter}`);
    renderLogsTable(data.logs);
    renderPagination('logsPagination', data.page, data.pages, loadLogs);
  } catch (e) { toast(e.message, 'error'); }
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logsTbody');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:40px">ไม่มี log</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="color:var(--text-3);font-family:'Fira Code',monospace;font-size:.78rem">#${l.id}</td>
      <td style="font-weight:600">${esc(l.username)}</td>
      <td style="font-family:'Fira Code',monospace;font-size:.8rem;color:var(--text-2)">${esc(l.ip || '-')}</td>
      <td style="font-size:.75rem;color:var(--text-3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.user_agent || '')}">${esc((l.user_agent || '-').slice(0, 60))}${(l.user_agent || '').length > 60 ? '…' : ''}</td>
      <td><span class="badge ${l.success ? 'badge-success' : 'badge-failed'}">${l.success ? '✓ สำเร็จ' : '✗ ล้มเหลว'}</span></td>
      <td style="color:var(--text-2);white-space:nowrap;font-size:.8rem">${fmt(l.created_at)}</td>
    </tr>
  `).join('');
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    A.logsFilter = btn.dataset.filter;
    loadLogs(1);
  });
});

/* ── Pagination ──────────────────────────────────────────────────── */
function renderPagination(containerId, current, total, loadFn) {
  const el = document.getElementById(containerId);
  if (!el || total <= 1) { if (el) el.innerHTML = ''; return; }
  const pages = getRange(current, total);
  el.innerHTML =
    `<button class="page-btn" onclick="(${loadFn.name})(${current - 1})" ${current <= 1 ? 'disabled' : ''}>‹</button>` +
    pages.map(p => p === '…'
      ? `<button class="page-btn" disabled>…</button>`
      : `<button class="page-btn${p === current ? ' active' : ''}" onclick="(${loadFn.name})(${p})">${p}</button>`
    ).join('') +
    `<button class="page-btn" onclick="(${loadFn.name})(${current + 1})" ${current >= total ? 'disabled' : ''}>›</button>`;
}

function getRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur <= 4)  return [1,2,3,4,5,'…',total];
  if (cur >= total - 3) return [1,'…',total-4,total-3,total-2,total-1,total];
  return [1,'…',cur-1,cur,cur+1,'…',total];
}

/* ── Helpers ─────────────────────────────────────────────────────── */
function openModal(id)  { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

/* ── Embedded: Google AI Studio Test ────────────────────────────── */
let gt2_platformInfo = null;   // stores google-imagen3 platform data

async function gt2_loadPlatformInfo() {
  try {
    const res  = await fetch('/api/admin/platforms', {
      headers: { Authorization: `Bearer ${A.token}` }
    });
    const data = await safeJson(res);
    if (!Array.isArray(data)) return;
    gt2_platformInfo = data.find(pl => pl.slug === 'google-imagen3') || null;
    const keyInput = document.getElementById('gt2_apiKey');
    if (keyInput && gt2_platformInfo?.has_key) {
      keyInput.placeholder = '(ใช้ key ที่บันทึกไว้ — หรือพิมพ์ key ใหม่เพื่อทดสอบ)';
    }
  } catch { /* silent */ }
}

function gt2_toggleKey() {
  const i = document.getElementById('gt2_apiKey');
  i.type = i.type === 'password' ? 'text' : 'password';
}

function gt2_isImageModel(m) {
  // ตรวจทั้ง model ID และ displayName เพราะ Google บางโมเดลใช้ชื่อแบบ
  // version-based (gemini-2.5-flash-preview-05-20) แต่ displayName บอก "Image"
  const name  = (m.name        || '').toLowerCase();
  const dname = (m.displayName || '').toLowerCase();
  const methods = m.supportedGenerationMethods || [];
  const anyStr = name + ' ' + dname;
  return methods.includes('predict') ||
    anyStr.includes('imagen') ||
    anyStr.includes('image-generation') ||
    anyStr.includes('image generation') ||
    anyStr.includes('-image') ||          // -image, -image-generation, -image-preview …
    anyStr.includes(' image');            // "Gemini 2.5 Flash Image …"
}

function gt2_modelRow(m, useFn, enabledSet) {
  const modelId = (m.name || '').replace('models/', '');
  const methods = m.supportedGenerationMethods || [];
  const tags = methods.map(met =>
    met === 'generateContent' ? `<span class="method-tag tag-gc">generateContent</span>` :
    met === 'predict'         ? `<span class="method-tag tag-pred">predict</span>` :
    `<span class="method-tag tag-misc">${esc(met)}</span>`
  ).join('');
  const checked = enabledSet && enabledSet.has(modelId) ? ' checked' : '';
  return `<tr>
    <td><input type="checkbox" class="gt2-model-cb" value="${esc(modelId)}"${checked}/></td>
    <td><code style="font-size:.74rem">${esc(modelId)}</code></td>
    <td style="font-size:.8rem">${esc(m.displayName || '')}</td>
    <td>${tags}</td>
    <td>${useFn ? `<button class="tc-btn-use" onclick="${useFn}('${esc(modelId)}')">ใช้</button>` : ''}</td>
  </tr>`;
}

async function gt2_listModels() {
  const apiKey = document.getElementById('gt2_apiKey').value.trim();
  // Allow using saved key when field is empty (if platform has one)
  const useSaved = !apiKey && gt2_platformInfo?.has_key;
  if (!apiKey && !useSaved) { alert('ใส่ API Key ก่อน หรือตั้งค่า key ใน Settings → API Keys'); return; }
  const btn = document.getElementById('gt2_listBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังโหลด...';
  try {
    const body = useSaved
      ? { __use_saved__: true, platform_slug: 'google-imagen3' }
      : { api_key: apiKey };
    const res  = await fetch('/api/test/google-list-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.token}` },
      body: JSON.stringify(body)
    });
    const data = await safeJson(res);
    const area  = document.getElementById('gt2_modelsArea');
    const title = document.getElementById('gt2_modelsTitle');
    const imgBody   = document.getElementById('gt2_imgBody');
    const otherBody = document.getElementById('gt2_otherBody');
    area.style.display = 'block';

    if (!data.ok) {
      title.textContent = '';
      imgBody.innerHTML = `<tr><td colspan="5" style="color:#be123c;padding:10px">${esc(data.error)}</td></tr>`;
      return;
    }
    const models    = data.models || [];
    const imgModels = models.filter(m => gt2_isImageModel(m));
    const others    = models.filter(m => !gt2_isImageModel(m));

    imgModels.sort((a,b) => {
      const score = m => {
        const s = (m.name||'').toLowerCase() + ' ' + (m.displayName||'').toLowerCase();
        return s.includes('imagen') ? 0 : s.includes('gemini') ? 1 : 2;
      };
      return score(a) - score(b);
    });

    // Build Set of currently enabled model IDs
    const enabledArr = gt2_platformInfo?.enabled_models || [];
    const enabledSet = new Set(Array.isArray(enabledArr) ? enabledArr : []);

    title.textContent = `พบ ${imgModels.length} models ที่สร้างภาพได้${others.length ? ` (+ ${others.length} อื่นๆ)` : ''}`;
    imgBody.innerHTML = imgModels.map(m => gt2_modelRow(m, 'gt2_useModel', enabledSet)).join('') +
      (others.length ? `<tr><td colspan="5" style="text-align:center;padding:8px">
        <button class="tc-debug-btn" onclick="gt2_toggleOthers()">▼ ดู ${others.length} models อื่นๆ</button>
      </td></tr>` : '');
    otherBody.innerHTML = others.map(m => gt2_modelRow(m, 'gt2_useModel', enabledSet)).join('');
    otherBody.style.display = 'none';
  } catch(e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '🔍 ดู Models'; }
}

function gt2_toggleOthers() {
  const b = document.getElementById('gt2_otherBody');
  const open = b.style.display === 'none';
  b.style.display = open ? '' : 'none';
}

function gt2_checkAllToggle(cb) {
  document.querySelectorAll('.gt2-model-cb').forEach(el => {
    el.checked = cb.checked;
  });
}

async function gt2_saveModels() {
  if (!gt2_platformInfo) { alert('ไม่พบข้อมูล platform — ลอง navigate เข้ามาหน้านี้ใหม่'); return; }
  const checked = Array.from(document.querySelectorAll('.gt2-model-cb:checked')).map(cb => cb.value);
  const statusEl = document.getElementById('gt2_saveStatus');
  if (statusEl) statusEl.textContent = '⏳ กำลังบันทึก...';
  try {
    const res = await fetch(`/api/admin/platforms/${gt2_platformInfo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.token}` },
      body: JSON.stringify({ enabled_models: checked })
    });
    const data = await safeJson(res);
    if (data.ok) {
      gt2_platformInfo.enabled_models = checked;
      if (statusEl) statusEl.textContent = `✅ บันทึก ${checked.length} models แล้ว`;
      toast(`บันทึก ${checked.length} models สำหรับ Prompt Lab แล้ว`, 'success');
    } else {
      if (statusEl) statusEl.textContent = '❌ บันทึกไม่ได้';
      alert('Error: ' + (data.error || 'unknown'));
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = '❌ เกิดข้อผิดพลาด';
    alert('Error: ' + e.message);
  }
}

function gt2_useModel(modelId) {
  document.getElementById('gt2_model').value = modelId;
  document.getElementById('gt2_model').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function gt2_generate() {
  const apiKey = document.getElementById('gt2_apiKey').value.trim();
  if (!apiKey) { alert('ใส่ API Key ก่อน'); return; }
  const prompt = document.getElementById('gt2_prompt').value.trim();
  if (!prompt)  { alert('ใส่ prompt ก่อน'); return; }
  const model  = document.getElementById('gt2_model').value.trim() || 'gemini-2.0-flash-exp';
  const ratio  = document.getElementById('gt2_ratio').value;
  const count  = parseInt(document.getElementById('gt2_count').value);
  const btn    = document.getElementById('gt2_genBtn');

  btn.disabled = true; btn.textContent = '⏳ กำลัง generate...';
  const ra = document.getElementById('gt2_resultArea');
  ra.style.display = 'block';
  document.getElementById('gt2_statusBadge').innerHTML = '<span class="gt-badge-wait">⏳ รอผล...</span>';
  document.getElementById('gt2_resultContent').innerHTML =
    `<p style="color:var(--text-2);font-size:.84rem">ส่งคำขอไปยัง <code style="color:var(--blue-2)">${esc(model)}</code>...</p>`;

  try {
    const res  = await fetch('/api/test/google-imagen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, model, prompt, aspect_ratio: ratio, sample_count: count })
    });
    gt2_renderResult(await safeJson(res));
  } catch(e) { gt2_renderResult({ ok: false, error: e.message }); }
  finally { btn.disabled = false; btn.textContent = '🚀 Generate & Test'; }
}

function gt2_renderResult(data) {
  const badge   = document.getElementById('gt2_statusBadge');
  const content = document.getElementById('gt2_resultContent');
  if (data.ok) {
    badge.innerHTML = '<span class="gt-badge-ok">✅ สำเร็จ</span>';
    const imgs = data.images || [];
    let html = `<p style="font-size:.82rem;color:var(--text-2);text-align:center;margin-bottom:12px">
      สำเร็จด้วย model: <b style="color:var(--green)">${esc(data.model_used)}</b></p>`;
    if (imgs.length) {
      html += `<div class="tc-img-grid">` + imgs.map((b64,i) =>
        `<div>
          <img src="data:image/jpeg;base64,${b64}" />
          <div style="text-align:center;margin-top:5px">
            <a class="btn-sm" href="data:image/jpeg;base64,${b64}" download="google-${i+1}.jpg">⬇ Download</a>
          </div>
        </div>`).join('') + `</div>`;
    }
    if (data.debug) html += gt2_debugBlock(data.debug);
    content.innerHTML = html;
  } else {
    badge.innerHTML = '<span class="gt-badge-fail">❌ ล้มเหลว</span>';
    content.innerHTML = `<div class="tc-error-box">${esc(data.error||'Unknown error')}</div>` +
      (data.debug ? gt2_debugBlock(data.debug) : '');
  }
}

function gt2_debugBlock(debug) {
  const id = 'dbg_' + Math.random().toString(36).slice(2,8);
  return `<button class="tc-debug-btn" onclick="document.getElementById('${id}').style.display=document.getElementById('${id}').style.display==='none'?'block':'none'">🔍 Raw Debug</button>
    <pre class="tc-debug-pre" id="${id}">${esc(JSON.stringify(debug,null,2))}</pre>`;
}

/* ── Settings: API Keys ─────────────────────────────────────────── */
// ข้อมูลเสริมของแต่ละ platform
const PLATFORM_META = {
  'google-imagen3': {
    purpose: 'สำหรับสร้างภาพด้วย Google Imagen 3 และ Gemini image generation',
    keyFormat: 'AIzaSy... (39 ตัวอักษร)',
    keyGetUrl: 'https://aistudio.google.com/apikey',
    keyGetLabel: 'รับ key จาก Google AI Studio',
    note: 'ใช้ key จาก AI Studio (generativelanguage.googleapis.com) — ไม่ใช่ Vertex AI Service Account',
  },
  'openai-dalle3': {
    purpose: 'สำหรับสร้างภาพด้วย DALL-E 3',
    keyFormat: 'sk-... (51 ตัวอักษร)',
    keyGetUrl: 'https://platform.openai.com/api-keys',
    keyGetLabel: 'รับ key จาก OpenAI Platform',
    note: 'ต้องมีเครดิตใน account ก่อนใช้งาน',
  },
  'openai-gpt-image-1': {
    purpose: 'สำหรับสร้างภาพด้วย GPT-Image-1 (รุ่นใหม่กว่า DALL-E 3)',
    keyFormat: 'sk-... (51 ตัวอักษร)',
    keyGetUrl: 'https://platform.openai.com/api-keys',
    keyGetLabel: 'รับ key จาก OpenAI Platform',
    note: 'ใช้ key เดียวกับ DALL-E 3 ได้เลย',
  },
  'stability-sd3': {
    purpose: 'สำหรับสร้างภาพด้วย Stable Diffusion 3.5',
    keyFormat: 'sk-... (Stability AI format)',
    keyGetUrl: 'https://platform.stability.ai/account/keys',
    keyGetLabel: 'รับ key จาก Stability AI',
    note: null,
  },
  'stability-sdxl': {
    purpose: 'สำหรับสร้างภาพด้วย Stable Diffusion XL',
    keyFormat: 'sk-... (Stability AI format)',
    keyGetUrl: 'https://platform.stability.ai/account/keys',
    keyGetLabel: 'รับ key จาก Stability AI',
    note: 'ใช้ key เดียวกับ SD3 ได้เลย',
  },
  'ideogram-v2': {
    purpose: 'สำหรับสร้างภาพด้วย Ideogram v2',
    keyFormat: 'ideogram API key',
    keyGetUrl: 'https://ideogram.ai/manage-api',
    keyGetLabel: 'รับ key จาก Ideogram',
    note: null,
  },
  'flux-replicate': {
    purpose: 'สำหรับสร้างภาพด้วย Flux 1.1 Pro บน Replicate',
    keyFormat: 'r8_... (Replicate format)',
    keyGetUrl: 'https://replicate.com/account/api-tokens',
    keyGetLabel: 'รับ key จาก Replicate',
    note: null,
  },
  'leonardo-ai': {
    purpose: 'สำหรับสร้างภาพด้วย Leonardo AI',
    keyFormat: 'Leonardo API key (UUID format)',
    keyGetUrl: 'https://app.leonardo.ai/settings/user-settings',
    keyGetLabel: 'รับ key จาก Leonardo AI',
    note: null,
  },
};

async function loadSettingsApiKeys() {
  const el = document.getElementById('apikeySettingsList');
  el.innerHTML = '<div style="color:var(--text-2);padding:12px">กำลังโหลด...</div>';
  try {
    const platforms = await api('GET', '/api/admin/platforms');
    el.innerHTML = platforms.map(p => {
      const meta = PLATFORM_META[p.slug] || {};
      const noteHtml = meta.note
        ? `<div class="apikey-note">⚠️ ${esc(meta.note)}</div>` : '';
      const purposeHtml = meta.purpose
        ? `<div class="apikey-purpose">🎯 ${esc(meta.purpose)}</div>` : '';
      const linkHtml = meta.keyGetUrl
        ? `<a class="apikey-getlink" href="${meta.keyGetUrl}" target="_blank">🔗 ${esc(meta.keyGetLabel || 'ขอ API Key')}</a>` : '';
      const formatHtml = meta.keyFormat
        ? `<span class="apikey-format">รูปแบบ: <code>${esc(meta.keyFormat)}</code></span>` : '';

      const enabledModelsJson = esc(JSON.stringify(p.enabled_models || []));
      return `
      <div class="apikey-setting-card" id="keycard-${p.id}"
           data-platform-id="${p.id}"
           data-enabled-models="${enabledModelsJson}">
        <div class="apikey-setting-header">
          <span class="apikey-setting-icon">${esc(p.icon || '🤖')}</span>
          <div style="flex:1">
            <div class="apikey-setting-name">${esc(p.name)}</div>
            <div class="apikey-setting-slug">${esc(p.slug)}</div>
          </div>
          <span class="apikey-status-chip ${p.has_key ? 'chip-ok' : 'chip-empty'}">
            ${p.has_key ? '✓ มี Key' : '— ยังไม่ตั้งค่า'}
          </span>
        </div>

        ${(purposeHtml || noteHtml || linkHtml) ? `
        <div class="apikey-meta-row">
          ${purposeHtml}
          ${noteHtml}
          <div class="apikey-meta-footer">${linkHtml}${formatHtml}</div>
        </div>` : ''}

        <div class="apikey-setting-body">
          <input type="password" class="apikey-setting-input" id="keyinput-${p.id}"
            placeholder="${meta.keyFormat ? esc(meta.keyFormat) : 'ใส่ API Key...'}"
            value="${p.has_key ? '••••••••••••••••' : ''}"
            data-has-key="${p.has_key ? '1' : '0'}"
            onfocus="clearPlaceholderKey(${p.id})"
          />
          <button class="btn-eye-sm" onclick="toggleSettingKey(${p.id})">👁</button>
          <button class="btn-save-key" onclick="saveSettingKey(${p.id})">💾 บันทึก</button>
          <button class="btn-test-key" id="testbtn-${p.id}"
            onclick="testSettingKey(${p.id}, '${esc(p.slug)}', '${esc(p.name)}')"
            ${p.slug !== 'google-imagen3' ? 'title="ยังไม่รองรับการทดสอบอัตโนมัติ"' : ''}>
            🧪 Test
          </button>
        </div>
        <div class="apikey-setting-status" id="keystatus-${p.id}">
          ${p.has_key
            ? '<span class="key-status-set">✓ มี API Key บันทึกอยู่แล้ว</span>'
            : '<span class="key-status-set" style="color:var(--text-3)">ยังไม่ได้ตั้งค่า</span>'}
        </div>
        <!-- inline model picker (populated by JS after Test click) -->
        <div id="modelpicker-${p.id}" style="display:none"></div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">${esc(e.message)}</div>`;
  }
}

function clearPlaceholderKey(id) {
  const inp = document.getElementById(`keyinput-${id}`);
  if (inp.dataset.hasKey === '1') { inp.value = ''; inp.dataset.hasKey = '0'; }
}

function toggleSettingKey(id) {
  const inp = document.getElementById(`keyinput-${id}`);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveSettingKey(id) {
  const inp    = document.getElementById(`keyinput-${id}`);
  const apiKey = inp.value.trim();
  const status = document.getElementById(`keystatus-${id}`);
  if (inp.dataset.hasKey === '1') { toast('กดที่ช่อง API Key เพื่อแก้ไขก่อน แล้วกด บันทึก', 'info'); return; }
  try {
    await api('PATCH', `/api/admin/platforms/${id}`, { api_key: apiKey });
    status.innerHTML = apiKey
      ? '<span class="key-status-ok">✅ บันทึก API Key สำเร็จ</span>'
      : '<span class="key-status-set" style="color:var(--text-3)">ลบ API Key แล้ว</span>';
    document.getElementById(`keyinput-${id}`).dataset.hasKey = apiKey ? '1' : '0';
    if (apiKey) document.getElementById(`keyinput-${id}`).value = '••••••••••••••••';
    toast('บันทึก API Key สำเร็จ', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function testSettingKey(id, slug, name) {
  const inp    = document.getElementById(`keyinput-${id}`);
  const btn    = document.getElementById(`testbtn-${id}`);
  const status = document.getElementById(`keystatus-${id}`);

  const rawVal = inp.value.trim();
  const useDb  = (!rawVal || rawVal === '••••••••••••••••');

  btn.disabled = true; btn.textContent = '⏳';
  status.innerHTML = '<span class="key-status-set">กำลังทดสอบ...</span>';

  try {
    if (slug === 'google-imagen3') {
      const body = useDb
        ? { api_key: '__use_saved__' }
        : { api_key: rawVal };
      const res  = await fetch('/api/test/google-list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${A.token}` },
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (data.ok) {
        const imgModels = (data.models || []).filter(m => gt2_isImageModel(m));
        status.innerHTML = `<span class="key-status-ok">✅ API Key ใช้งานได้ — พบ ${imgModels.length} image models</span>`;
        // get current enabled_models from card data attribute
        const card = document.getElementById(`keycard-${id}`);
        let currentEnabled = [];
        try { currentEnabled = JSON.parse(card.dataset.enabledModels || '[]'); } catch {}
        renderInlineModelPicker(id, imgModels, currentEnabled);
      } else {
        status.innerHTML = `<span class="key-status-fail">❌ ${esc(data.error || 'ไม่สามารถเชื่อมต่อได้')}</span>`;
        // hide picker on error
        const picker = document.getElementById(`modelpicker-${id}`);
        if (picker) picker.style.display = 'none';
      }
      return;
    }
    // Other platforms
    status.innerHTML = '<span class="key-status-set">⚠️ การทดสอบอัตโนมัติสำหรับ platform นี้ยังไม่รองรับ</span>';
    toast(`ยังไม่รองรับการทดสอบสำหรับ ${name}`, 'info');
  } catch (e) {
    status.innerHTML = `<span class="key-status-fail">❌ ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = '🧪 Test';
  }
}

function renderInlineModelPicker(cardId, imgModels, currentEnabled) {
  const picker = document.getElementById(`modelpicker-${cardId}`);
  if (!picker) return;

  const enabledSet = new Set(Array.isArray(currentEnabled) ? currentEnabled : []);

  if (!imgModels.length) {
    picker.innerHTML = `<div class="apikey-model-picker">
      <p class="amp-empty">ไม่พบ models ที่สร้างภาพได้ — ตรวจสอบสิทธิ์การใช้งาน API Key</p>
    </div>`;
    picker.style.display = 'block';
    return;
  }

  picker.innerHTML = `
    <div class="apikey-model-picker">
      <div class="amp-header">
        <span class="amp-title">🧠 เลือก Models สำหรับ Prompt Lab</span>
        <span class="amp-count">${imgModels.length} image models</span>
      </div>
      <div class="amp-list" id="amplist-${cardId}">
        ${imgModels.map(m => {
          const modelId = (m.name||'').replace('models/', '');
          const checked = enabledSet.has(modelId) ? ' checked' : '';
          return `<label class="amp-item${enabledSet.has(modelId) ? ' checked' : ''}">
            <input type="checkbox" class="amp-cb" value="${esc(modelId)}"
                   onchange="ampToggleLabel(this)"${checked}/>
            <span class="amp-model-id">${esc(modelId)}</span>
            <span class="amp-display-name">${esc(m.displayName||'')}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="amp-footer">
        <label style="font-size:.76rem;color:var(--text-3);display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="ampcheckall-${cardId}" onchange="ampCheckAll('${cardId}', this)"
                 style="accent-color:var(--blue-2)"/>
          เลือกทั้งหมด
        </label>
        <button class="amp-save-btn" onclick="saveModelPicker(${cardId})">
          💾 บันทึก
        </button>
        <span class="amp-save-status" id="amp-status-${cardId}">
          ${enabledSet.size ? `✓ เปิดใช้งานอยู่ ${enabledSet.size} models` : ''}
        </span>
      </div>
    </div>`;

  picker.style.display = 'block';

  // sync check-all state
  const allCbs = picker.querySelectorAll('.amp-cb');
  const allChecked = Array.from(allCbs).every(cb => cb.checked);
  const checkAllEl = document.getElementById(`ampcheckall-${cardId}`);
  if (checkAllEl) checkAllEl.checked = allChecked;
}

function ampToggleLabel(cb) {
  cb.closest('.amp-item').classList.toggle('checked', cb.checked);
  // update check-all
  const list = cb.closest('.amp-list');
  const allCbs = list?.querySelectorAll('.amp-cb') || [];
  const allChecked = Array.from(allCbs).every(c => c.checked);
  const picker = cb.closest('.apikey-model-picker');
  const checkAllEl = picker?.querySelector('[id^="ampcheckall-"]');
  if (checkAllEl) checkAllEl.checked = allChecked;
}

function ampCheckAll(cardId, masterCb) {
  document.querySelectorAll(`#amplist-${cardId} .amp-cb`).forEach(cb => {
    cb.checked = masterCb.checked;
    cb.closest('.amp-item').classList.toggle('checked', masterCb.checked);
  });
}

async function saveModelPicker(cardId) {
  const statusEl = document.getElementById(`amp-status-${cardId}`);
  const checked  = Array.from(
    document.querySelectorAll(`#amplist-${cardId} .amp-cb:checked`)
  ).map(cb => cb.value);

  statusEl.textContent = '⏳ กำลังบันทึก...';
  try {
    const res = await fetch(`/api/admin/platforms/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.token}` },
      body: JSON.stringify({ enabled_models: checked })
    });
    const data = await safeJson(res);
    if (data.ok) {
      // update data attribute on card
      const card = document.getElementById(`keycard-${cardId}`);
      if (card) card.dataset.enabledModels = JSON.stringify(checked);
      statusEl.textContent = `✅ บันทึก ${checked.length} models แล้ว`;
      toast(`เปิดใช้งาน ${checked.length} models สำหรับ Prompt Lab`, 'success');
    } else {
      statusEl.textContent = '❌ บันทึกไม่ได้';
      toast(data.error || 'บันทึกไม่ได้', 'error');
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
  }
}


/* showApiTestModal ยังเก็บไว้สำหรับ platform อื่นในอนาคต */
function showApiTestModal(platformName, ok, message, models) {
  document.getElementById('apikeyTestModalTitle').textContent = `🧪 ทดสอบ — ${platformName}`;
  const statusEl  = document.getElementById('apikeyTestStatus');
  const modelsEl  = document.getElementById('apikeyTestModels');
  const tbody     = document.getElementById('apikeyTestModelsTbody');

  statusEl.className = `apitest-status ${ok ? 'apitest-ok' : 'apitest-fail'}`;
  statusEl.textContent = (ok ? '✅ ' : '❌ ') + message;
  modelsEl.style.display = 'none';
  document.getElementById('apikeyTestModal').removeAttribute('hidden');
}

/* ── Init ────────────────────────────────────────────────────────── */
async function init() {
  if (!A.token) {
    // ไม่ได้ login → กลับหน้าหลัก
    window.location.href = '/';
    return;
  }
  try {
    // ตรวจสอบ token และสิทธิ์ admin กับ server
    const me = await api('GET', '/api/auth/me');
    if (!me.is_admin) {
      alert('คุณไม่มีสิทธิ์เข้าถึง Admin Console');
      window.location.href = '/';
      return;
    }
    // แสดง UI
    document.querySelector('.sidebar').style.display = 'flex';
    document.getElementById('adminInfo').textContent = A.username;
    navigateTo('dashboard');
  } catch (e) {
    window.location.href = '/';
  }
}

init();
