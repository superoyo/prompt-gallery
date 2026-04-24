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
  else if (page === 'users')   loadUsers(1);
  else if (page === 'prompts') loadPrompts(1);
  else if (page === 'logs')    loadLogs(1);
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
