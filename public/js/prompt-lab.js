/* ═══════════════════════════════════════════════════════════════
   prompt-lab.js  —  Prompt Lab feature logic
   Depends on app.js being loaded first (for toast, escHtml, etc.)
   ═══════════════════════════════════════════════════════════════ */

/* ── State ───────────────────────────────────────────────────── */
const labState = {
  selectedPlatforms: new Set(),
  selectedRatio: '1:1',
  quality: 'standard',
  platforms: [],
  historyPage: 1,
  isGenerating: false,
};

/* ── Auth Helpers ────────────────────────────────────────────── */

/**
 * Read auth from localStorage (mirrors app.js state)
 */
function getLabAuth() {
  return {
    token:    localStorage.getItem('pg_token'),
    username: localStorage.getItem('pg_username'),
    isAdmin:  localStorage.getItem('pg_is_admin') === 'true',
  };
}

/**
 * Return fetch headers with Authorization if logged in.
 */
function authHeaders() {
  const { token } = getLabAuth();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Perform a JSON API request with auth header.
 * @param {string} method
 * @param {string} path
 * @param {object|null} body
 */
async function labApi(method, path, body = null) {
  const opts = {
    method,
    headers: {
      ...authHeaders(),
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Toast Helper ────────────────────────────────────────────── */

/**
 * Show a toast notification.
 * Re-uses app.js's toast() if available, otherwise creates one inline.
 */
function showToast(msg, type = 'info') {
  if (typeof toast === 'function') {
    toast(msg, type);
    return;
  }
  // Fallback: create inline toast
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Utility ─────────────────────────────────────────────────── */

/**
 * Safely escape HTML for rendering user content.
 * Falls back to app.js escHtml if available.
 */
function labEsc(str) {
  if (typeof escHtml === 'function') return escHtml(str);
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format an ISO date string into human-readable Thai locale date.
 */
function labFormatDate(iso) {
  if (typeof formatDate === 'function') return formatDate(iso);
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/**
 * Estimate token count from text.
 * Approximation: words * 1.33
 */
function estimateTokens(text) {
  return Math.max(1, Math.round(
    text.split(/\s+/).filter(Boolean).length * 1.33
  ));
}

/**
 * Truncate text to maxLen characters, appending ellipsis if needed.
 */
function truncate(str, maxLen = 120) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/* ── Platform Loading ────────────────────────────────────────── */

/**
 * Fetch available AI platforms from the backend and render them.
 * Uses GET /api/platforms?all=1  — returns all platforms incl. disabled ones.
 */
async function loadPlatforms() {
  try {
    const data = await labApi('GET', '/api/platforms?all=1');
    const platforms = Array.isArray(data) ? data : (data.platforms || []);
    labState.platforms = platforms;
    renderPlatformGrid(platforms);
    populateHistoryFilter(platforms);
  } catch (e) {
    console.error('[PromptLab] loadPlatforms error:', e);
    document.getElementById('platformGrid').innerHTML =
      `<div class="platform-loading">ไม่สามารถโหลด platforms ได้: ${labEsc(e.message)}</div>`;
  }
}

/**
 * Render the platform selection grid.
 * @param {Array} platforms
 */
function renderPlatformGrid(platforms) {
  const grid = document.getElementById('platformGrid');
  const hint = document.getElementById('noPlatformsHint');

  if (!platforms || platforms.length === 0) {
    grid.innerHTML = '';
    hint.style.display = '';
    return;
  }

  const enabledPlatforms = platforms.filter(p => p.enabled !== false);
  if (enabledPlatforms.length === 0) {
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }

  grid.innerHTML = platforms.map(p => {
    const isEnabled = p.enabled !== false;
    const slug = labEsc(p.slug || p.id || p.name);
    const icon = labEsc(p.icon || '🤖');
    const name = labEsc(p.name || p.slug);
    const cost = p.cost_per_gen != null
      ? `~$${Number(p.cost_per_gen).toFixed(4)} / gen`
      : 'ราคาตามจริง';
    const statusClass = isEnabled ? 'enabled' : 'disabled-badge';
    const statusText  = isEnabled ? 'พร้อมใช้งาน' : 'ไม่ได้ตั้งค่า';
    const disabledClass = isEnabled ? '' : ' disabled';

    return `
      <div class="platform-card${disabledClass}"
           data-slug="${slug}"
           onclick="${isEnabled ? `togglePlatform('${slug}')` : ''}">
        <input type="checkbox" class="platform-checkbox" id="chk-${slug}" />
        <span class="platform-icon">${icon}</span>
        <div class="platform-name">${name}</div>
        <div class="platform-cost">${cost}</div>
        <span class="platform-status ${statusClass}">${statusText}</span>
      </div>`;
  }).join('');
}

/**
 * Toggle a platform's selection state.
 * @param {string} slug
 */
function togglePlatform(slug) {
  if (labState.selectedPlatforms.has(slug)) {
    labState.selectedPlatforms.delete(slug);
  } else {
    labState.selectedPlatforms.add(slug);
  }
  // Update card visual
  const card = document.querySelector(`.platform-card[data-slug="${slug}"]`);
  if (card) card.classList.toggle('selected', labState.selectedPlatforms.has(slug));

  // Update count badge
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = `${labState.selectedPlatforms.size} ตัวที่เลือก`;

  updateGenerateBtn();
}

/* ── Generate Button State ───────────────────────────────────── */

/**
 * Enable or disable the generate button based on current state.
 */
function updateGenerateBtn() {
  const btn  = document.getElementById('generateBtn');
  const hint = document.getElementById('generateHint');
  const prompt = (document.getElementById('promptInput')?.value || '').trim();

  if (!btn) return;

  const hasPlatform = labState.selectedPlatforms.size > 0;
  const hasPrompt   = prompt.length > 0;
  const notBusy     = !labState.isGenerating;

  btn.disabled = !(hasPlatform && hasPrompt && notBusy);

  if (!hasPlatform && !hasPrompt) {
    hint.textContent = 'เลือก platform และใส่ prompt ก่อน';
  } else if (!hasPlatform) {
    hint.textContent = 'เลือก platform อย่างน้อย 1 ตัว';
  } else if (!hasPrompt) {
    hint.textContent = 'ใส่ prompt ก่อน generate';
  } else if (labState.isGenerating) {
    hint.textContent = 'กำลัง generate...';
  } else {
    hint.textContent = `จะ generate ${labState.selectedPlatforms.size} ภาพ`;
  }
}

/* ── Generate ────────────────────────────────────────────────── */

/**
 * Kick off image generation for all selected platforms.
 */
async function generate() {
  if (labState.isGenerating) return;

  const prompt = (document.getElementById('promptInput')?.value || '').trim();
  const negPrompt = (document.getElementById('negPromptInput')?.value || '').trim();

  if (!prompt) {
    showToast('กรุณาใส่ prompt ก่อน', 'error');
    return;
  }
  if (labState.selectedPlatforms.size === 0) {
    showToast('กรุณาเลือก platform อย่างน้อย 1 ตัว', 'error');
    return;
  }

  labState.isGenerating = true;
  updateGenerateBtn();

  const btn = document.getElementById('generateBtn');
  const btnText = document.getElementById('generateBtnText');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'กำลัง Generate...';

  // Show results section with loading skeletons
  const resultsSection = document.getElementById('resultsSection');
  const resultsGrid    = document.getElementById('resultsGrid');
  if (resultsSection) resultsSection.style.display = '';

  const platformList = [...labState.selectedPlatforms];
  if (resultsGrid) {
    resultsGrid.innerHTML = platformList.map(slug => {
      const p = labState.platforms.find(x => (x.slug || x.id || x.name) === slug);
      const name = p ? labEsc(p.name || p.slug) : labEsc(slug);
      const icon = p ? labEsc(p.icon || '🤖') : '🤖';
      return `
        <div class="result-card result-loading" id="result-${labEsc(slug)}">
          <div class="result-header">
            <span class="platform-icon-sm">${icon}</span>
            ${name}
          </div>
          <div class="skeleton-img"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>`;
    }).join('');
  }

  // Scroll into view
  resultsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const payload = {
      prompt,
      platforms: platformList,
      negative_prompt: negPrompt || undefined,
      size: labState.selectedRatio,
      quality: labState.quality,
    };

    const data = await labApi('POST', '/api/lab/generate', payload);
    const results = Array.isArray(data) ? data : (data.results || []);
    renderResults(results, prompt);

    showToast(`Generate สำเร็จ ${results.filter(r => r.success || r.image_url).length}/${results.length} ภาพ`, 'success');

    // Refresh history and stats
    await Promise.all([loadHistory(), loadStats()]);

  } catch (e) {
    console.error('[PromptLab] generate error:', e);
    showToast(`Generate ล้มเหลว: ${e.message}`, 'error');
    // Show error in all pending cards
    if (resultsGrid) {
      platformList.forEach(slug => {
        const card = document.getElementById(`result-${slug}`);
        if (card) {
          card.classList.remove('result-loading');
          const bodyEl = card.querySelector('.skeleton-img, .skeleton-line');
          if (bodyEl) {
            card.innerHTML = card.querySelector('.result-header').outerHTML +
              `<div class="result-error">
                <div class="result-error-icon">❌</div>
                <div class="result-error-msg">${labEsc(e.message)}</div>
              </div>`;
          }
        }
      });
    }
  } finally {
    labState.isGenerating = false;
    if (btnText) btnText.textContent = 'Generate';
    updateGenerateBtn();
  }
}

/**
 * Render generation results into the results grid.
 * @param {Array} results  - array of {platform, slug, success, image_url, tokens_used, cost_usd, error}
 * @param {string} prompt
 */
function renderResults(results, prompt) {
  const grid = document.getElementById('resultsGrid');
  if (!grid) return;

  grid.innerHTML = results.map(r => {
    const p = labState.platforms.find(x => (x.slug || x.id) === r.slug || x.name === r.platform);
    const icon = p ? labEsc(p.icon || '🤖') : '🤖';
    const name = labEsc(r.platform || r.slug || '');
    const slug = labEsc(r.slug || r.platform || '');

    const header = `
      <div class="result-header">
        <span class="platform-icon-sm">${icon}</span>
        ${name}
      </div>`;

    if (r.success || r.image_url) {
      const imgSrc = labEsc(r.image_url || '');
      const tokens = r.tokens_used != null ? `${r.tokens_used} tokens` : '';
      const cost   = r.cost_usd    != null ? `$${Number(r.cost_usd).toFixed(4)}` : '';

      return `
        <div class="result-card" id="result-${slug}">
          ${header}
          <div class="result-img-wrap" onclick="openLightbox('${imgSrc}', '${labEsc(prompt).replace(/'/g, '&#039;')}')">
            <img class="result-img" src="${imgSrc}" alt="${labEsc(prompt)}" loading="lazy" />
            <div class="result-img-overlay">🔍</div>
          </div>
          <div class="result-meta">
            ${tokens ? `<span class="result-badge">${labEsc(tokens)}</span>` : ''}
            ${cost   ? `<span class="result-badge cost">${labEsc(cost)}</span>` : ''}
          </div>
        </div>`;
    } else {
      const errMsg = labEsc(r.error || r.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
      return `
        <div class="result-card" id="result-${slug}">
          ${header}
          <div class="result-error">
            <div class="result-error-icon">❌</div>
            <strong>Generate ล้มเหลว</strong>
            <div class="result-error-msg">${errMsg}</div>
          </div>
        </div>`;
    }
  }).join('');
}

/* ── History ─────────────────────────────────────────────────── */

/**
 * Load generation history from the backend.
 * @param {number} page
 */
async function loadHistory(page = 1) {
  labState.historyPage = page;

  const platformFilter = document.getElementById('historyPlatformFilter')?.value || '';
  const listEl = document.getElementById('historyList');
  if (listEl) {
    listEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>กำลังโหลด...</p></div>`;
  }

  try {
    let url = `/api/lab/history?page=${page}&limit=10`;
    if (platformFilter) url += `&platform=${encodeURIComponent(platformFilter)}`;

    const data = await labApi('GET', url);
    renderHistoryList(data);
    renderHistoryPagination(data);
  } catch (e) {
    console.error('[PromptLab] loadHistory error:', e);
    if (listEl) {
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">⚠️</span>
          <p>โหลดประวัติไม่ได้: ${labEsc(e.message)}</p>
        </div>`;
    }
  }
}

/**
 * Render history items into #historyList.
 * @param {object} data - { items: [...], total, page, pages }
 */
function renderHistoryList(data) {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;

  const items = Array.isArray(data) ? data : (data.items || data.history || []);

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">📭</span>
        <p>ยังไม่มีประวัติการ generate</p>
      </div>`;
    return;
  }

  listEl.innerHTML = `<div class="history-list">${
    items.map(item => {
      const imgSrc   = labEsc(item.image_url || '');
      const platform = labEsc(item.platform || item.platform_name || item.platform_slug || '');
      const prompt   = labEsc(truncate(item.prompt || '', 120));
      const tokens   = item.tokens_used != null ? `${item.tokens_used} tokens` : '';
      const cost     = item.cost_usd    != null ? `$${Number(item.cost_usd).toFixed(4)}` : '';
      const date     = labFormatDate(item.created_at || item.timestamp || '');

      const thumb = imgSrc
        ? `<img class="history-thumb" src="${imgSrc}" alt="${prompt}"
              onclick="openLightbox('${imgSrc}', '${labEsc(item.prompt || '').replace(/'/g, '&#039;')}')"
              loading="lazy" />`
        : `<div class="history-thumb-placeholder">🖼️</div>`;

      return `
        <div class="history-item">
          ${thumb}
          <div class="history-info">
            <span class="history-platform-badge">${platform}</span>
            <div class="history-prompt" title="${labEsc(item.prompt || '')}">${prompt}</div>
            <div class="history-meta">
              ${tokens ? `<span class="result-badge">${labEsc(tokens)}</span>` : ''}
              ${cost   ? `<span class="result-badge cost">${labEsc(cost)}</span>`   : ''}
            </div>
          </div>
          <div class="history-date">${date}</div>
        </div>`;
    }).join('')
  }</div>`;
}

/**
 * Render pagination controls for history.
 * @param {object} data - { page, pages, total }
 */
function renderHistoryPagination(data) {
  const paginEl = document.getElementById('historyPagination');
  if (!paginEl) return;

  const totalPages = data.pages || data.total_pages || 1;
  const current    = labState.historyPage;

  if (totalPages <= 1) {
    paginEl.innerHTML = '';
    return;
  }

  let html = '';
  html += `<button class="page-btn" onclick="loadHistory(${current - 1})"
              ${current <= 1 ? 'disabled' : ''}>← ก่อนหน้า</button>`;

  // Show up to 5 page numbers around the current page
  const start = Math.max(1, current - 2);
  const end   = Math.min(totalPages, current + 2);
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn${i === current ? ' current' : ''}"
                onclick="loadHistory(${i})">${i}</button>`;
  }

  html += `<button class="page-btn" onclick="loadHistory(${current + 1})"
              ${current >= totalPages ? 'disabled' : ''}>ถัดไป →</button>`;

  paginEl.innerHTML = html;
}

/* ── Stats ───────────────────────────────────────────────────── */

/**
 * Load per-platform usage statistics.
 */
async function loadStats() {
  const statsEl = document.getElementById('statsList');
  if (statsEl) {
    statsEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>กำลังโหลด...</p></div>`;
  }

  try {
    const data = await labApi('GET', '/api/lab/stats');
    const stats = Array.isArray(data) ? data : (data.stats || data.platforms || []);
    renderStats(stats);
  } catch (e) {
    console.error('[PromptLab] loadStats error:', e);
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">⚠️</span>
          <p>โหลดสถิติไม่ได้: ${labEsc(e.message)}</p>
        </div>`;
    }
  }
}

/**
 * Render platform statistics cards.
 * @param {Array} stats - array of per-platform stat objects
 */
function renderStats(stats) {
  const statsEl = document.getElementById('statsList');
  if (!statsEl) return;

  if (!stats || stats.length === 0) {
    statsEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">📊</span>
        <p>ยังไม่มีข้อมูลสถิติ</p>
      </div>`;
    return;
  }

  statsEl.innerHTML = `<div class="stats-grid">${
    stats.map(s => {
      // Find matching platform for the icon
      const slug = s.slug || s.platform_slug || s.platform;
      const p = labState.platforms.find(x =>
        (x.slug || x.id) === slug || x.name === s.platform_name
      );
      const icon = p ? labEsc(p.icon || '🤖') : '🤖';
      const name = labEsc(s.platform_name || s.platform || slug || '—');

      const totalGens   = s.total_gens   ?? s.total     ?? 0;
      const successGens = s.success_gens ?? s.successes  ?? 0;
      const totalTokens = s.total_tokens ?? s.tokens     ?? 0;
      const totalCost   = s.total_cost   ?? s.cost_usd   ?? 0;

      return `
        <div class="stat-platform-card">
          <div class="stat-platform-header">
            <span class="stat-platform-icon">${icon}</span>
            <span class="stat-platform-name">${name}</span>
          </div>
          <div class="stat-metrics">
            <div class="metric">
              <span class="metric-label">Generate ทั้งหมด</span>
              <span class="metric-value">${totalGens.toLocaleString()}</span>
            </div>
            <div class="metric">
              <span class="metric-label">สำเร็จ</span>
              <span class="metric-value">${successGens.toLocaleString()}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Tokens รวม</span>
              <span class="metric-value">${Number(totalTokens).toLocaleString()}</span>
            </div>
            <div class="metric">
              <span class="metric-label">ค่าใช้จ่ายรวม</span>
              <span class="metric-value cost">$${Number(totalCost).toFixed(4)}</span>
            </div>
          </div>
        </div>`;
    }).join('')
  }</div>`;
}

/* ── Tab Switching ───────────────────────────────────────────── */

/**
 * Switch between the history and stats tabs.
 * @param {string} tab - 'history' | 'stats'
 */
function switchTab(tab) {
  // Update tab button styles
  document.querySelectorAll('.lab-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/hide content panels
  const historyPanel = document.getElementById('tab-history');
  const statsPanel   = document.getElementById('tab-stats');

  if (historyPanel) historyPanel.style.display = tab === 'history' ? '' : 'none';
  if (statsPanel)   statsPanel.style.display   = tab === 'stats'   ? '' : 'none';

  // Load data on first switch to stats
  if (tab === 'stats') {
    const statsEl = document.getElementById('statsList');
    const isEmpty = statsEl?.querySelector('.loading-state');
    if (isEmpty) loadStats();
  }
}

/* ── Lightbox ────────────────────────────────────────────────── */

/**
 * Open the lightbox modal to display a full-size image.
 * @param {string} imagePath
 * @param {string} altText
 */
function openLightbox(imagePath, altText) {
  const modal   = document.getElementById('lightboxModal');
  const content = document.getElementById('lightboxContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <img class="lightbox-img" src="${labEsc(imagePath)}" alt="${labEsc(altText)}" />
    <p class="lightbox-caption">${labEsc(altText)}</p>`;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  // Close on backdrop click
  modal.onclick = (e) => { if (e.target === modal) closeLightbox(); };
}

/**
 * Close the lightbox modal.
 */
function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

/* ── Prompt Helpers ──────────────────────────────────────────── */

/**
 * Show or hide the negative prompt textarea.
 */
function toggleNegPrompt() {
  const area   = document.getElementById('negPromptArea');
  const toggle = document.getElementById('negToggle');
  if (!area) return;

  const isHidden = area.style.display === 'none';
  area.style.display = isHidden ? '' : 'none';
  if (toggle) {
    toggle.textContent = isHidden ? '－ ซ่อน Negative Prompt' : '＋ เพิ่ม Negative Prompt';
  }
}

/**
 * Clear the main prompt textarea and reset token count.
 */
function clearPrompt() {
  const input = document.getElementById('promptInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  const est = document.getElementById('tokenEstimate');
  if (est) est.textContent = '~0 tokens';
  updateGenerateBtn();
}

/* ── Ratio Selector ──────────────────────────────────────────── */

/**
 * Handle ratio button clicks from event delegation.
 */
function setupRatioSelector() {
  const container = document.getElementById('ratioSelector');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.ratio-btn');
    if (!btn) return;

    // Toggle active class
    container.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    labState.selectedRatio = btn.dataset.ratio || '1:1';
  });
}

/* ── History Platform Filter ─────────────────────────────────── */

/**
 * Populate the history platform filter dropdown.
 * @param {Array} platforms
 */
function populateHistoryFilter(platforms) {
  const select = document.getElementById('historyPlatformFilter');
  if (!select) return;

  const existingOptions = select.querySelector('option[value=""]');
  // Clear all except "all platforms" option
  select.innerHTML = `<option value="">ทุก Platform</option>`;

  platforms
    .filter(p => p.enabled !== false)
    .forEach(p => {
      const slug = p.slug || p.id || p.name;
      const name = p.name || p.slug;
      const opt  = document.createElement('option');
      opt.value       = slug;
      opt.textContent = name;
      select.appendChild(opt);
    });
}

/* ── Auth Area ───────────────────────────────────────────────── */

/**
 * Render the navbar auth area.
 * Calls app.js renderAuthArea() if available, otherwise renders manually.
 */
function labRenderAuthArea() {
  if (typeof renderAuthArea === 'function') {
    renderAuthArea();
    return;
  }

  const el = document.getElementById('authArea');
  if (!el) return;

  const { token, username, isAdmin } = getLabAuth();
  if (token && username) {
    el.innerHTML = `
      <div class="auth-logged-in">
        ${isAdmin ? `<a href="/admin" class="btn-admin-console">⚙ Admin Console</a>` : ''}
        <span class="auth-username">${labEsc(username)}</span>
        <button class="btn-logout" onclick="labLogout()">ออกจากระบบ</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="auth-logged-out">
        <button class="btn-login" onclick="window.location.href='/'">เข้าสู่ระบบ</button>
      </div>`;
  }
}

/**
 * Fallback logout handler (app.js logout() preferred).
 */
function labLogout() {
  if (typeof logout === 'function') { logout(); return; }
  localStorage.removeItem('pg_token');
  localStorage.removeItem('pg_username');
  localStorage.removeItem('pg_is_admin');
  window.location.reload();
}

/* ── Init ────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {

  // 1. Render auth navbar
  labRenderAuthArea();

  const { token } = getLabAuth();
  const loginNotice = document.getElementById('loginNotice');
  const labMain     = document.getElementById('labMain');

  // 2. Gate on auth
  if (!token) {
    if (loginNotice) loginNotice.style.display = '';
    if (labMain)     labMain.style.display = 'none';
    return;
  }

  // User is logged in — show main lab
  if (loginNotice) loginNotice.style.display = 'none';
  if (labMain)     labMain.style.display = '';

  // 3. Setup UI interactions

  // Prompt textarea — live token count + button state
  const promptInput = document.getElementById('promptInput');
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      const text = promptInput.value;
      const est  = document.getElementById('tokenEstimate');
      if (est) {
        const count = text.trim() ? estimateTokens(text) : 0;
        est.textContent = `~${count} tokens`;
      }
      updateGenerateBtn();
    });
  }

  // Quality select
  const qualitySelect = document.getElementById('qualitySelect');
  if (qualitySelect) {
    qualitySelect.addEventListener('change', () => {
      labState.quality = qualitySelect.value;
    });
  }

  // Ratio selector (event delegation)
  setupRatioSelector();

  // ESC key closes lightbox
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  // 4. Load data in parallel
  await Promise.all([
    loadPlatforms(),
    loadHistory(),
  ]);

  // Initial button state
  updateGenerateBtn();
});
