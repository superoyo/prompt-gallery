/* ── Survey page ─────────────────────────────────────────────────── */

function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function toggleNavDropdown(itemId, e) {
  e?.stopPropagation();
  const item = document.getElementById(itemId);
  if (!item) return;
  const open = item.classList.contains('open');
  document.querySelectorAll('.nav-item.open').forEach(el => el.classList.remove('open'));
  if (!open) item.classList.add('open');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.nav-item.open').forEach(el => el.classList.remove('open'));
});

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (!el) return;
  const token = localStorage.getItem('pg_token');
  const username = localStorage.getItem('pg_username');
  const isAdmin = localStorage.getItem('pg_is_admin') === 'true';
  if (token && username) {
    el.innerHTML = `
      <div class="auth-logged-in">
        ${isAdmin ? `<a href="/admin" class="btn-admin-console">⚙ Admin Console</a>` : ''}
        <span class="auth-username">${escHtml(username)}</span>
        <a href="/" class="btn-logout">กลับหน้าหลัก</a>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="auth-logged-out">
        <a href="/" class="btn-login">กลับหน้าหลัก</a>
      </div>`;
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showSuccess() {
  const card = document.getElementById('surveyCard');
  card.innerHTML = `
    <div class="survey-success">
      <div class="survey-success-icon">✓</div>
      <h2>ส่งสำเร็จ</h2>
      <p>ขอบคุณที่กรอกแบบสอบถาม</p>
      <a href="/" class="btn-primary" style="display:inline-flex">กลับหน้าหลัก</a>
    </div>`;
}

document.getElementById('surveyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('surveyError');
  const btn = document.getElementById('surveySubmit');
  const name = document.getElementById('surveyName').value.trim();
  const phone = document.getElementById('surveyPhone').value.trim();

  errEl.textContent = '';
  if (!name) { errEl.textContent = 'กรุณากรอกชื่อ'; return; }
  if (!phone) { errEl.textContent = 'กรุณากรอกเบอร์โทร'; return; }

  btn.disabled = true;
  btn.textContent = 'กำลังส่ง…';
  try {
    const res = await fetch('/api/survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast('ส่งแบบสอบถามสำเร็จ', 'success');
    showSuccess();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'ส่งแบบสอบถาม';
  }
});

renderAuthArea();
