/* ── State ───────────────────────────────────────────────────────── */
const state = {
  token:    localStorage.getItem('pg_token'),
  username: localStorage.getItem('pg_username'),
  isAdmin:  localStorage.getItem('pg_is_admin') === 'true',
  category:   'All',
  search:     '',
  page:       1,
  totalPages: 1,
  categories:    [],     // [{id, name, is_visible, prompt_count}]
  showAllCats:   false,  // false = เฉพาะที่มีข้อมูล, true = ทั้งหมด
  searchTimer:   null,
};

/* ── API ─────────────────────────────────────────────────────────── */
async function api(method, path, body = null, isForm = false) {
  const opts = {
    method,
    headers: {},
  };
  if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
  if (body) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Auth ────────────────────────────────────────────────────────── */
function setAuth(token, username, isAdmin = false) {
  state.token    = token;
  state.username = username;
  state.isAdmin  = isAdmin;
  localStorage.setItem('pg_token',    token);
  localStorage.setItem('pg_username', username);
  localStorage.setItem('pg_is_admin', isAdmin ? 'true' : 'false');
  renderAuthArea();
}

function clearAuth() {
  state.token    = null;
  state.username = null;
  state.isAdmin  = false;
  localStorage.removeItem('pg_token');
  localStorage.removeItem('pg_username');
  localStorage.removeItem('pg_is_admin');
  renderAuthArea();
}

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (state.token && state.username) {
    el.innerHTML = `
      <div class="auth-logged-in">
        ${state.isAdmin ? `<a href="/admin" class="btn-admin-console">⚙ Admin Console</a>` : ''}
        <span class="auth-username">${escHtml(state.username)}</span>
        <button class="btn-logout" onclick="logout()">ออกจากระบบ</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="auth-logged-out">
        <button class="btn-login" onclick="openModal('loginModal')">เข้าสู่ระบบ</button>
        <button class="btn-register" onclick="openModal('registerModal')">สมัครสมาชิก</button>
      </div>`;
  }
}

async function logout() {
  clearAuth();
  toast('ออกจากระบบแล้ว', 'info');
}

/* ── Categories ──────────────────────────────────────────────────── */
async function loadCategories() {
  try {
    // ดึงพร้อม prompt_count เสมอ
    const data = await api('GET', '/api/categories?with_count=1&visible_only=0');
    state.categories = data; // [{id, name, is_visible, prompt_count, sort_order}]
    renderTabs();
    populateCategorySelect();
  } catch (e) {
    console.error(e);
  }
}

function getVisibleCategories() {
  return state.categories.filter(c => {
    if (!c.is_visible) return false;            // ซ่อนโดย admin → ไม่แสดงเลย
    if (state.showAllCats) return true;         // แสดงทั้งหมด
    return c.prompt_count > 0;                 // เฉพาะที่มีข้อมูล
  });
}

function renderTabs() {
  const el = document.getElementById('categoryTabs');
  const visible = getVisibleCategories();

  // All tab + visible categories
  const allTab = `<button class="tab-btn${state.category === 'All' ? ' active' : ''}" onclick="setCategory('All')">All</button>`;
  const catTabs = visible.map(c => `
    <button class="tab-btn${c.name === state.category ? ' active' : ''}"
            onclick="setCategory('${escHtml(c.name)}')">
      ${escHtml(c.name)}
      ${!state.showAllCats ? '' : `<span class="tab-count">${c.prompt_count}</span>`}
    </button>
  `).join('');

  // toggle button
  const toggle = `
    <div class="tabs-toggle-wrap">
      <button class="tabs-toggle ${state.showAllCats ? 'active' : ''}" onclick="toggleShowAllCats()" title="${state.showAllCats ? 'แสดงเฉพาะที่มีข้อมูล' : 'แสดงทั้งหมด'}">
        ${state.showAllCats ? '✦ ทั้งหมด' : '✦ มีข้อมูล'}
      </button>
    </div>`;

  el.innerHTML = allTab + catTabs + toggle;

  // ถ้า category ปัจจุบันไม่อยู่ในรายการที่มองเห็น ให้ reset เป็น All
  if (state.category !== 'All' && !visible.find(c => c.name === state.category)) {
    state.category = 'All';
  }
}

function toggleShowAllCats() {
  state.showAllCats = !state.showAllCats;
  renderTabs();
}

function setCategory(cat) {
  state.category = cat;
  state.page = 1;
  renderTabs();
  loadPrompts();
}

function populateCategorySelect() {
  const sel = document.getElementById('categorySelect');
  if (!sel) return;
  // form dropdown แสดงเฉพาะ visible categories
  sel.innerHTML = state.categories
    .filter(c => c.is_visible)
    .map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`)
    .join('');
}

/* ── Prompts ─────────────────────────────────────────────────────── */
async function loadPrompts() {
  const grid = document.getElementById('promptGrid');
  grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>กำลังโหลด...</p></div>`;

  try {
    const params = new URLSearchParams({
      page: state.page,
      ...(state.category !== 'All' && { category: state.category }),
      ...(state.search && { search: state.search }),
    });
    const data = await api('GET', `/api/prompts?${params}`);
    state.totalPages = data.pages;
    renderGrid(data.prompts, data.total);
    renderPagination(data.page, data.pages);
    updateStats(data.total);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p style="color:#f87171">โหลดข้อมูลล้มเหลว: ${escHtml(e.message)}</p></div>`;
  }
}

function renderGrid(prompts, total) {
  const grid = document.getElementById('promptGrid');
  if (!prompts.length) {
    const tpl = document.getElementById('emptyTpl').content.cloneNode(true);
    grid.innerHTML = '';
    grid.appendChild(tpl);
    return;
  }
  grid.innerHTML = '';
  prompts.forEach(p => grid.appendChild(buildCard(p)));
}

function buildCard(p) {
  const tpl = document.getElementById('cardTpl').content.cloneNode(true);
  const article = tpl.querySelector('.card');
  article.dataset.id = p.id;

  const imgWrap = article.querySelector('.card-img-wrap');
  const img = article.querySelector('.card-img');
  const placeholder = article.querySelector('.card-img-placeholder');

  if (p.image_path) {
    img.src = imgSrc(p.image_path);
    img.alt = p.title;
    placeholder.classList.add('hidden');
  } else {
    img.style.display = 'none';
  }

  article.querySelector('.card-category').textContent = p.category;
  article.querySelector('.card-date').textContent = formatDate(p.created_at);
  article.querySelector('.card-title').textContent = p.title;
  article.querySelector('.card-desc').textContent = p.description || p.prompt_text.slice(0, 100) + '…';
  article.querySelector('.card-author span').textContent = p.username;

  article.querySelector('.btn-view').addEventListener('click', (e) => {
    e.stopPropagation();
    openViewModal(p);
  });
  article.addEventListener('click', () => openViewModal(p));

  return article;
}

/* ── View Modal ──────────────────────────────────────────────────── */
function openViewModal(p) {
  const content = document.getElementById('viewModalContent');
  const isOwner = state.username === p.username;

  content.innerHTML = `
    <div class="view-image-section">
      ${p.image_path
        ? `<img class="view-img" src="${escHtml(imgSrc(p.image_path))}" alt="${escHtml(p.title)}" />`
        : `<div class="view-img-placeholder">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
               <rect x="3" y="3" width="18" height="18" rx="2"/>
               <path d="M3 9l4-4 4 4 4-5 4 5"/><circle cx="8.5" cy="8.5" r="1.5"/>
             </svg>
             <span>ไม่มีรูปภาพตัวอย่าง</span>
           </div>`}
    </div>
    <div class="view-info-section">
      <span class="view-category-badge">${escHtml(p.category)}</span>
      <h2 class="view-title">${escHtml(p.title)}</h2>
      ${p.description ? `<p class="view-desc">${escHtml(p.description)}</p>` : ''}
      <div class="view-meta">
        <span class="view-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          ${escHtml(p.username)}
        </span>
        <span class="view-meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          ${formatDate(p.created_at)}
        </span>
      </div>
      <div>
        <p class="prompt-label">Prompt</p>
        <pre class="prompt-code">${escHtml(p.prompt_text)}</pre>
      </div>
      <div class="prompt-actions">
        <button class="btn-copy" onclick="copyPrompt('${p.id}', this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          คัดลอก Prompt
        </button>
        ${isOwner
          ? `<button class="btn-danger" onclick="deletePrompt(${p.id})">ลบ</button>`
          : ''}
      </div>
    </div>`;

  // Store prompt text for copying
  content.dataset.promptText = p.prompt_text;
  content.dataset.promptId = p.id;

  openModal('viewModal');
}

async function copyPrompt(id, btn) {
  const text = document.getElementById('viewModalContent').dataset.promptText;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '✓ คัดลอกแล้ว!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg> คัดลอก Prompt`;
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    toast('ไม่สามารถคัดลอกได้', 'error');
  }
}

async function deletePrompt(id) {
  if (!confirm('ยืนยันการลบ prompt นี้?')) return;
  try {
    await api('DELETE', `/api/prompts/${id}`);
    closeModal('viewModal');
    toast('ลบ prompt แล้ว', 'success');
    loadPrompts();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Add Prompt ──────────────────────────────────────────────────── */
function openAddModal() {
  if (!state.token) {
    openModal('loginModal');
    toast('กรุณาเข้าสู่ระบบก่อนเพิ่ม prompt', 'info');
    return;
  }
  openModal('addModal');
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('submitBtn');
  const errEl = document.getElementById('addError');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const formData = new FormData(form);
    await api('POST', '/api/prompts', formData, true);
    closeModal('addModal');
    form.reset();
    document.getElementById('imagePreview').hidden = true;
    document.getElementById('uploadPlaceholder').style.display = '';
    toast('เพิ่ม Prompt สำเร็จ! 🎉', 'success');
    state.page = 1;
    loadPrompts();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'บันทึก Prompt';
  }
});

/* ── Image Upload ─────────────────────────────────────────────────── */
const uploadArea = document.getElementById('uploadArea');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');

uploadArea.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => showPreview(e.target.files[0]));

uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) {
    imageInput.files = e.dataTransfer.files;
    showPreview(file);
  }
});

function showPreview(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.src = e.target.result;
    imagePreview.hidden = false;
    uploadPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

/* ── Auth Forms ──────────────────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const data = await api('POST', '/api/auth/login', {
      username: form.username.value.trim(),
      password: form.password.value,
    });
    setAuth(data.token, data.username, data.is_admin || false);
    closeModal('loginModal');
    form.reset();
    toast(`ยินดีต้อนรับ, ${data.username}!`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  try {
    const data = await api('POST', '/api/auth/register', {
      username: form.username.value.trim(),
      password: form.password.value,
    });
    setAuth(data.token, data.username, data.is_admin || false);
    closeModal('registerModal');
    form.reset();
    toast(`สมัครสำเร็จ! ยินดีต้อนรับ, ${data.username}!`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function switchToRegister() {
  closeModal('loginModal');
  setTimeout(() => openModal('registerModal'), 150);
}
function switchToLogin() {
  closeModal('registerModal');
  setTimeout(() => openModal('loginModal'), 150);
}

/* ── Add Prompt Button ───────────────────────────────────────────── */
document.getElementById('btnAddPrompt').addEventListener('click', (e) => {
  e.preventDefault();
  openAddModal();
});

/* ── Search ──────────────────────────────────────────────────────── */
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    state.page = 1;
    loadPrompts();
  }, 400);
});

/* ── Pagination ──────────────────────────────────────────────────── */
function renderPagination(current, total) {
  const el = document.getElementById('pagination');
  if (total <= 1) { el.innerHTML = ''; return; }

  let html = '';
  const prev = current > 1;
  const next = current < total;

  html += `<button class="page-btn" onclick="goPage(${current - 1})" ${!prev ? 'disabled' : ''}>‹</button>`;

  const pages = getPageRange(current, total);
  pages.forEach(p => {
    if (p === '…') {
      html += `<button class="page-btn" disabled>…</button>`;
    } else {
      html += `<button class="page-btn${p === current ? ' active' : ''}" onclick="goPage(${p})">${p}</button>`;
    }
  });

  html += `<button class="page-btn" onclick="goPage(${current + 1})" ${!next ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;
}

function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

function goPage(page) {
  state.page = page;
  loadPrompts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Stats ───────────────────────────────────────────────────────── */
function updateStats(total) {
  const el = document.getElementById('heroStats');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-item">
      <span class="stat-num">${total.toLocaleString()}</span>
      <span class="stat-label">Prompts ทั้งหมด</span>
    </div>
    <div class="stat-item">
      <span class="stat-num">${(state.categories.length - 1).toLocaleString()}</span>
      <span class="stat-label">หมวดหมู่</span>
    </div>`;
}

/* ── Modal Helpers ───────────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
  document.body.style.overflow = '';
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ['viewModal', 'addModal', 'loginModal', 'registerModal'].forEach(id => {
      if (!document.getElementById(id).hidden) closeModal(id);
    });
  }
});

/* ── Toast ───────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Utilities ───────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** รูปภาพ: ถ้าเป็น URL เต็ม (Cloudinary) ใช้โดยตรง ไม่ก็เติม /uploads/ */
function imgSrc(path) {
  if (!path) return '';
  return path.startsWith('http') ? path : `/uploads/${path}`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return iso; }
}

/* ── Nav Dropdown ────────────────────────────────────────────────── */
function toggleNavDropdown(itemId, e) {
  e && e.stopPropagation();
  const item = document.getElementById(itemId);
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.nav-item.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.nav-item.open').forEach(el => el.classList.remove('open'));
});

/* ── Init ────────────────────────────────────────────────────────── */
async function init() {
  renderAuthArea();
  await loadCategories();
  await loadPrompts();
}

init();
