import os
import uuid
import sqlite3
import hashlib
import hmac
import base64
import json
import time
import string
import random
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory
from PIL import Image
import bcrypt

BASE_DIR = Path(__file__).parent.resolve()
app = Flask(__name__, static_folder=str(BASE_DIR / 'public'), static_url_path='')

# ─── Config ──────────────────────────────────────────────────────────────────
SECRET_KEY   = os.environ.get('SECRET_KEY', 'prompt-gallery-secret-key-2024')
UPLOAD_FOLDER = BASE_DIR / 'public' / 'uploads'
DB_PATH       = BASE_DIR / 'data' / 'database.db'
MAX_IMAGE_SIZE = (1200, 1200)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
SUPER_ADMIN_EMAIL  = 'superoyo@gmail.com'

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DEFAULT_CATEGORIES = [
    'Social Media', 'Infographic', 'YouTube Thumbnail',
    'Comic / Storyboard', 'Poster / Flyer', 'Product Marketing',
    'Avatar / Profile', 'UI Mockup', 'Other'
]


# ─── Database ─────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS categories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT UNIQUE NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_visible INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                email         TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                is_disabled   INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL,
                last_login_at TEXT
            );
            CREATE TABLE IF NOT EXISTS prompts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                description TEXT,
                prompt_text TEXT NOT NULL,
                image_path  TEXT,
                category    TEXT NOT NULL DEFAULT 'Other',
                user_id     INTEGER NOT NULL,
                username    TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS login_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                username   TEXT NOT NULL,
                ip         TEXT,
                user_agent TEXT,
                success    INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
        ''')
        # migrate existing users table (add columns if missing)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
        for col, definition in [
            ('email',         'TEXT'),          # UNIQUE ไม่รองรับ ALTER TABLE ใน SQLite
            ('is_admin',      'INTEGER NOT NULL DEFAULT 0'),
            ('is_disabled',   'INTEGER NOT NULL DEFAULT 0'),
            ('last_login_at', 'TEXT'),
        ]:
            if col not in cols:
                conn.execute(f'ALTER TABLE users ADD COLUMN {col} {definition}')

    _ensure_super_admin()
    _seed_categories()


def _seed_categories():
    """Seed DEFAULT_CATEGORIES ถ้า categories table ว่างอยู่"""
    with get_db() as conn:
        count = conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            for i, name in enumerate(DEFAULT_CATEGORIES):
                conn.execute(
                    'INSERT OR IGNORE INTO categories (name, sort_order, is_visible, created_at) VALUES (?,?,1,?)',
                    (name, i, now)
                )


def _ensure_super_admin():
    """สร้าง super admin (superoyo) หากยังไม่มี"""
    with get_db() as conn:
        existing = conn.execute(
            'SELECT id FROM users WHERE email=?', (SUPER_ADMIN_EMAIL,)
        ).fetchone()
        if not existing:
            pw = 'Admin@1234'          # password เริ่มต้น — เปลี่ยนได้ผ่านหน้า admin
            pw_hash = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                'INSERT OR IGNORE INTO users (username, email, password_hash, is_admin, created_at) '
                'VALUES (?,?,?,1,?)',
                ('superoyo', SUPER_ADMIN_EMAIL, pw_hash, now)
            )
        else:
            # ตรวจสอบว่า is_admin ถูกตั้งค่าแล้ว
            conn.execute(
                'UPDATE users SET is_admin=1 WHERE email=?', (SUPER_ADMIN_EMAIL,)
            )


init_db()


# ─── JWT ──────────────────────────────────────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def _unb64(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + '=' * (pad % 4))

def create_token(user_id: int, username: str, is_admin: bool = False) -> str:
    header  = _b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload = _b64(json.dumps({
        'sub': user_id, 'username': username, 'is_admin': is_admin,
        'exp': int(time.time()) + 86400 * 7
    }).encode())
    sig = _b64(hmac.new(SECRET_KEY.encode(),
                        f'{header}.{payload}'.encode(),
                        hashlib.sha256).digest())
    return f'{header}.{payload}.{sig}'

def verify_token(token: str):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, payload, sig = parts
        expected = _b64(hmac.new(SECRET_KEY.encode(),
                                 f'{header}.{payload}'.encode(),
                                 hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(payload))
        if data.get('exp', 0) < time.time():
            return None
        return data
    except Exception:
        return None

def get_current_user():
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        return verify_token(auth[7:])
    return None

def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'กรุณาเข้าสู่ระบบ'}), 401
        # ตรวจสอบว่า account ถูก disable หรือไม่
        with get_db() as conn:
            row = conn.execute('SELECT is_disabled FROM users WHERE id=?', (user['sub'],)).fetchone()
        if row and row['is_disabled']:
            return jsonify({'error': 'บัญชีนี้ถูกระงับการใช้งาน'}), 403
        request.current_user = user
        return fn(*args, **kwargs)
    return wrapper

def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'กรุณาเข้าสู่ระบบ'}), 401
        if not user.get('is_admin'):
            return jsonify({'error': 'ไม่มีสิทธิ์เข้าถึง Admin'}), 403
        request.current_user = user
        return fn(*args, **kwargs)
    return wrapper


# ─── Helpers ──────────────────────────────────────────────────────────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_image(file) -> str:
    filename  = f'{uuid.uuid4()}.webp'
    save_path = UPLOAD_FOLDER / filename
    img = Image.open(file)
    img.thumbnail(MAX_IMAGE_SIZE, Image.LANCZOS)
    if img.mode in ('RGBA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        bg.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
        img = bg
    img.save(save_path, 'WEBP', quality=85)
    return filename

def row_to_dict(row):
    return dict(row)

def get_client_ip():
    return (request.headers.get('X-Forwarded-For', '') or
            request.remote_addr or 'unknown').split(',')[0].strip()

def log_login(user_id, username, success: bool):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            'INSERT INTO login_logs (user_id, username, ip, user_agent, success, created_at) '
            'VALUES (?,?,?,?,?,?)',
            (user_id, username, get_client_ip(),
             request.headers.get('User-Agent', '')[:200], int(success), now)
        )
        if success and user_id:
            conn.execute('UPDATE users SET last_login_at=? WHERE id=?', (now, user_id))

def random_password(length=12) -> str:
    chars = string.ascii_letters + string.digits + '!@#$'
    return ''.join(random.choices(chars, k=length))


# ─── Auth Routes ──────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def register():
    data     = request.get_json()
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    email    = (data.get('email') or '').strip().lower() or None

    if not username or not password:
        return jsonify({'error': 'กรุณากรอก username และ password'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username ต้องมีอย่างน้อย 3 ตัวอักษร'}), 400
    if len(password) < 4:
        return jsonify({'error': 'Password ต้องมีอย่างน้อย 4 ตัวอักษร'}), 400

    # ตรวจสอบว่าเป็น super admin email หรือไม่
    is_admin = 1 if email == SUPER_ADMIN_EMAIL else 0
    pw_hash  = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    now      = datetime.now(timezone.utc).isoformat()

    try:
        with get_db() as conn:
            cursor = conn.execute(
                'INSERT INTO users (username, email, password_hash, is_admin, created_at) '
                'VALUES (?,?,?,?,?)',
                (username, email, pw_hash, is_admin, now)
            )
            user_id = cursor.lastrowid
        log_login(user_id, username, True)
        token = create_token(user_id, username, bool(is_admin))
        return jsonify({'token': token, 'username': username, 'is_admin': bool(is_admin)}), 201
    except sqlite3.IntegrityError as e:
        if 'username' in str(e).lower():
            return jsonify({'error': 'Username นี้ถูกใช้ไปแล้ว'}), 409
        return jsonify({'error': 'Email นี้ถูกใช้ไปแล้ว'}), 409


@app.route('/api/auth/login', methods=['POST'])
def login():
    data     = request.get_json()
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()

    if not user or not bcrypt.checkpw(password.encode(), user['password_hash'].encode()):
        log_login(user['id'] if user else None, username, False)
        return jsonify({'error': 'Username หรือ Password ไม่ถูกต้อง'}), 401

    if user['is_disabled']:
        log_login(user['id'], username, False)
        return jsonify({'error': 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อ Admin'}), 403

    log_login(user['id'], username, True)
    token = create_token(user['id'], username, bool(user['is_admin']))
    return jsonify({
        'token': token,
        'username': username,
        'is_admin': bool(user['is_admin'])
    })


@app.route('/api/auth/me', methods=['GET'])
@require_auth
def me():
    u = request.current_user
    return jsonify({'username': u['username'], 'sub': u['sub'], 'is_admin': u.get('is_admin', False)})


# ─── Prompt Routes ────────────────────────────────────────────────────────────

@app.route('/api/prompts', methods=['GET'])
def list_prompts():
    category = request.args.get('category', '')
    search   = request.args.get('search', '').strip()
    page     = max(1, int(request.args.get('page', 1)))
    per_page = 24

    query  = 'SELECT * FROM prompts WHERE 1=1'
    params = []

    if category and category != 'All':
        query += ' AND category=?'
        params.append(category)
    if search:
        query += ' AND (title LIKE ? OR description LIKE ? OR prompt_text LIKE ?)'
        s = f'%{search}%'
        params.extend([s, s, s])

    count_query  = query.replace('SELECT *', 'SELECT COUNT(*)')
    query       += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params_page  = params + [per_page, (page - 1) * per_page]

    with get_db() as conn:
        total = conn.execute(count_query, params).fetchone()[0]
        rows  = conn.execute(query, params_page).fetchall()

    return jsonify({
        'prompts': [row_to_dict(r) for r in rows],
        'total': total, 'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page
    })


@app.route('/api/prompts/<int:prompt_id>', methods=['GET'])
def get_prompt(prompt_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM prompts WHERE id=?', (prompt_id,)).fetchone()
    if not row:
        return jsonify({'error': 'ไม่พบ prompt นี้'}), 404
    return jsonify(row_to_dict(row))


@app.route('/api/prompts', methods=['POST'])
@require_auth
def create_prompt():
    title       = request.form.get('title', '').strip()
    description = request.form.get('description', '').strip()
    prompt_text = request.form.get('prompt_text', '').strip()
    category    = request.form.get('category', 'Other').strip()

    if not title or not prompt_text:
        return jsonify({'error': 'กรุณากรอก title และ prompt'}), 400

    image_path = None
    if 'image' in request.files:
        file = request.files['image']
        if file and file.filename and allowed_file(file.filename):
            try:
                image_path = process_image(file)
            except Exception as e:
                return jsonify({'error': f'อัปโหลดรูปล้มเหลว: {str(e)}'}), 400

    now  = datetime.now(timezone.utc).isoformat()
    user = request.current_user

    with get_db() as conn:
        cursor = conn.execute(
            'INSERT INTO prompts (title,description,prompt_text,image_path,category,user_id,username,created_at) '
            'VALUES (?,?,?,?,?,?,?,?)',
            (title, description, prompt_text, image_path, category,
             user['sub'], user['username'], now)
        )
        prompt_id = cursor.lastrowid
    with get_db() as conn:
        row = conn.execute('SELECT * FROM prompts WHERE id=?', (prompt_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/prompts/<int:prompt_id>', methods=['DELETE'])
@require_auth
def delete_prompt(prompt_id):
    user = request.current_user
    with get_db() as conn:
        row = conn.execute('SELECT * FROM prompts WHERE id=?', (prompt_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ prompt'}), 404
        # admin ลบได้ทุก prompt
        if row['user_id'] != user['sub'] and not user.get('is_admin'):
            return jsonify({'error': 'ไม่มีสิทธิ์ลบ prompt นี้'}), 403
        if row['image_path']:
            (UPLOAD_FOLDER / row['image_path']).unlink(missing_ok=True)
        conn.execute('DELETE FROM prompts WHERE id=?', (prompt_id,))
    return jsonify({'ok': True})


@app.route('/api/categories', methods=['GET'])
def get_categories():
    """
    หน้าบ้านใช้ endpoint นี้
    ?visible_only=1  → เฉพาะ is_visible=1 (default)
    ?visible_only=0  → ทั้งหมด
    ?with_count=1    → แนบจำนวน prompt แต่ละหมวดด้วย
    """
    visible_only = request.args.get('visible_only', '1') != '0'
    with_count   = request.args.get('with_count', '0') == '1'

    if with_count:
        rows = get_db().execute('''
            SELECT c.id, c.name, c.sort_order, c.is_visible,
                   COUNT(p.id) AS prompt_count
            FROM categories c
            LEFT JOIN prompts p ON p.category = c.name
            WHERE (? = 0 OR c.is_visible = 1)
            GROUP BY c.id
            ORDER BY c.sort_order, c.name
        ''', (0 if not visible_only else 1,)).fetchall()
        return jsonify([row_to_dict(r) for r in rows])

    query = 'SELECT name FROM categories'
    params = []
    if visible_only:
        query += ' WHERE is_visible=1'
    query += ' ORDER BY sort_order, name'
    rows = get_db().execute(query, params).fetchall()
    return jsonify([r['name'] for r in rows])


# ─── Admin Routes ─────────────────────────────────────────────────────────────

@app.route('/api/admin/stats', methods=['GET'])
@require_admin
def admin_stats():
    today = datetime.now(timezone.utc).date().isoformat()
    with get_db() as conn:
        total_users   = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        total_prompts = conn.execute('SELECT COUNT(*) FROM prompts').fetchone()[0]
        total_logs    = conn.execute('SELECT COUNT(*) FROM login_logs').fetchone()[0]
        today_logins  = conn.execute(
            "SELECT COUNT(*) FROM login_logs WHERE success=1 AND created_at LIKE ?",
            (f'{today}%',)
        ).fetchone()[0]
        disabled_users = conn.execute(
            'SELECT COUNT(*) FROM users WHERE is_disabled=1'
        ).fetchone()[0]
        failed_today  = conn.execute(
            "SELECT COUNT(*) FROM login_logs WHERE success=0 AND created_at LIKE ?",
            (f'{today}%',)
        ).fetchone()[0]
    return jsonify({
        'total_users': total_users,
        'total_prompts': total_prompts,
        'total_logs': total_logs,
        'today_logins': today_logins,
        'disabled_users': disabled_users,
        'failed_today': failed_today,
    })


@app.route('/api/admin/users', methods=['GET'])
@require_admin
def admin_list_users():
    search = request.args.get('search', '').strip()
    page   = max(1, int(request.args.get('page', 1)))
    per_page = 20

    query  = '''
        SELECT u.*,
               COUNT(DISTINCT p.id) AS prompt_count
        FROM users u
        LEFT JOIN prompts p ON p.user_id = u.id
        WHERE 1=1
    '''
    params = []
    if search:
        query += ' AND (u.username LIKE ? OR u.email LIKE ?)'
        s = f'%{search}%'
        params.extend([s, s])

    count_sql = f'SELECT COUNT(*) FROM users u WHERE 1=1'
    if search:
        count_sql += ' AND (u.username LIKE ? OR u.email LIKE ?)'

    query += ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?'

    with get_db() as conn:
        total = conn.execute(count_sql, params).fetchone()[0]
        rows  = conn.execute(query, params + [per_page, (page-1)*per_page]).fetchall()

    users = []
    for r in rows:
        d = row_to_dict(r)
        d.pop('password_hash', None)   # ไม่ส่ง hash ออก
        users.append(d)

    return jsonify({
        'users': users, 'total': total, 'page': page,
        'pages': (total + per_page - 1) // per_page
    })


@app.route('/api/admin/users/<int:user_id>/toggle-disable', methods=['PATCH'])
@require_admin
def admin_toggle_disable(user_id):
    current_admin = request.current_user
    with get_db() as conn:
        row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ user'}), 404
        # ป้องกันการ disable super admin
        if row['email'] == SUPER_ADMIN_EMAIL:
            return jsonify({'error': 'ไม่สามารถระงับ Super Admin ได้'}), 403
        # ป้องกันการ disable ตัวเอง
        if row['id'] == current_admin['sub']:
            return jsonify({'error': 'ไม่สามารถระงับบัญชีของตัวเองได้'}), 403

        new_state = 0 if row['is_disabled'] else 1
        conn.execute('UPDATE users SET is_disabled=? WHERE id=?', (new_state, user_id))

    return jsonify({'ok': True, 'is_disabled': bool(new_state)})


@app.route('/api/admin/users/<int:user_id>/reset-password', methods=['POST'])
@require_admin
def admin_reset_password(user_id):
    data = request.get_json() or {}
    new_password = data.get('new_password', '').strip()

    # ถ้าไม่ได้ส่งมา ให้ generate เอง
    if not new_password:
        new_password = random_password()

    if len(new_password) < 4:
        return jsonify({'error': 'Password ต้องมีอย่างน้อย 4 ตัวอักษร'}), 400

    with get_db() as conn:
        row = conn.execute('SELECT id FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ user'}), 404
        pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        conn.execute('UPDATE users SET password_hash=? WHERE id=?', (pw_hash, user_id))

    return jsonify({'ok': True, 'new_password': new_password})


@app.route('/api/admin/users/<int:user_id>/set-admin', methods=['PATCH'])
@require_admin
def admin_set_admin(user_id):
    """เพิ่ม/ถอน สิทธิ์ admin (เฉพาะ super admin เท่านั้น)"""
    current_admin = request.current_user
    with get_db() as conn:
        me_row = conn.execute('SELECT email FROM users WHERE id=?', (current_admin['sub'],)).fetchone()
        if not me_row or me_row['email'] != SUPER_ADMIN_EMAIL:
            return jsonify({'error': 'เฉพาะ Super Admin เท่านั้น'}), 403
        row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ user'}), 404
        new_state = 0 if row['is_admin'] else 1
        conn.execute('UPDATE users SET is_admin=? WHERE id=?', (new_state, user_id))
    return jsonify({'ok': True, 'is_admin': bool(new_state)})


@app.route('/api/admin/logs', methods=['GET'])
@require_admin
def admin_logs():
    page     = max(1, int(request.args.get('page', 1)))
    per_page = 30
    filter_  = request.args.get('filter', 'all')  # all | success | failed

    query  = 'SELECT * FROM login_logs WHERE 1=1'
    params = []
    if filter_ == 'success':
        query += ' AND success=1'
    elif filter_ == 'failed':
        query += ' AND success=0'

    count_query = query.replace('SELECT *', 'SELECT COUNT(*)')
    query      += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

    with get_db() as conn:
        total = conn.execute(count_query, params).fetchone()[0]
        rows  = conn.execute(query, params + [per_page, (page-1)*per_page]).fetchall()

    return jsonify({
        'logs': [row_to_dict(r) for r in rows],
        'total': total, 'page': page,
        'pages': (total + per_page - 1) // per_page
    })


@app.route('/api/admin/prompts', methods=['GET'])
@require_admin
def admin_list_prompts():
    search   = request.args.get('search', '').strip()
    page     = max(1, int(request.args.get('page', 1)))
    per_page = 20

    query  = 'SELECT * FROM prompts WHERE 1=1'
    params = []
    if search:
        query += ' AND (title LIKE ? OR username LIKE ?)'
        s = f'%{search}%'
        params.extend([s, s])

    count_query = query.replace('SELECT *', 'SELECT COUNT(*)')
    query      += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

    with get_db() as conn:
        total = conn.execute(count_query, params).fetchone()[0]
        rows  = conn.execute(query, params + [per_page, (page-1)*per_page]).fetchall()

    return jsonify({
        'prompts': [row_to_dict(r) for r in rows],
        'total': total, 'page': page,
        'pages': (total + per_page - 1) // per_page
    })


# ─── Admin Category Routes ────────────────────────────────────────────────────

@app.route('/api/admin/categories', methods=['GET'])
@require_admin
def admin_list_categories():
    """ดูทุกหมวดหมู่พร้อมจำนวน prompt และสถานะ"""
    rows = get_db().execute('''
        SELECT c.id, c.name, c.sort_order, c.is_visible, c.created_at,
               COUNT(p.id) AS prompt_count
        FROM categories c
        LEFT JOIN prompts p ON p.category = c.name
        GROUP BY c.id
        ORDER BY c.sort_order, c.name
    ''').fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route('/api/admin/categories', methods=['POST'])
@require_admin
def admin_create_category():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'กรุณากรอกชื่อหมวดหมู่'}), 400
    if len(name) > 60:
        return jsonify({'error': 'ชื่อยาวเกิน 60 ตัวอักษร'}), 400

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        # sort_order = max + 1
        max_order = conn.execute('SELECT COALESCE(MAX(sort_order),0) FROM categories').fetchone()[0]
        try:
            cursor = conn.execute(
                'INSERT INTO categories (name, sort_order, is_visible, created_at) VALUES (?,?,1,?)',
                (name, max_order + 1, now)
            )
            cat_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            return jsonify({'error': f'หมวดหมู่ "{name}" มีอยู่แล้ว'}), 409
    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id=?', (cat_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/admin/categories/<int:cat_id>', methods=['PATCH'])
@require_admin
def admin_update_category(cat_id):
    data = request.get_json()
    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id=?', (cat_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบหมวดหมู่'}), 404

        old_name   = row['name']
        new_name   = (data.get('name') or old_name).strip()
        is_visible = data.get('is_visible', row['is_visible'])
        sort_order = data.get('sort_order', row['sort_order'])

        try:
            conn.execute(
                'UPDATE categories SET name=?, is_visible=?, sort_order=? WHERE id=?',
                (new_name, int(is_visible), int(sort_order), cat_id)
            )
            # อัปเดต category ใน prompts ด้วยถ้าชื่อเปลี่ยน
            if new_name != old_name:
                conn.execute('UPDATE prompts SET category=? WHERE category=?', (new_name, old_name))
        except sqlite3.IntegrityError:
            return jsonify({'error': f'ชื่อ "{new_name}" ซ้ำกับหมวดหมู่อื่น'}), 409

    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id=?', (cat_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route('/api/admin/categories/<int:cat_id>/toggle-visible', methods=['PATCH'])
@require_admin
def admin_toggle_category_visible(cat_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id=?', (cat_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบหมวดหมู่'}), 404
        new_state = 0 if row['is_visible'] else 1
        conn.execute('UPDATE categories SET is_visible=? WHERE id=?', (new_state, cat_id))
    return jsonify({'ok': True, 'is_visible': bool(new_state)})


@app.route('/api/admin/categories/<int:cat_id>', methods=['DELETE'])
@require_admin
def admin_delete_category(cat_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id=?', (cat_id,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบหมวดหมู่'}), 404
        # ป้องกันลบถ้ามี prompt ใช้อยู่
        count = conn.execute(
            'SELECT COUNT(*) FROM prompts WHERE category=?', (row['name'],)
        ).fetchone()[0]
        if count > 0:
            return jsonify({'error': f'ไม่สามารถลบได้ มี {count} prompt ใช้หมวดหมู่นี้อยู่'}), 409
        conn.execute('DELETE FROM categories WHERE id=?', (cat_id,))
    return jsonify({'ok': True})


@app.route('/api/admin/categories/reorder', methods=['POST'])
@require_admin
def admin_reorder_categories():
    """รับ list ของ {id, sort_order} แล้วอัปเดตลำดับ"""
    items = request.get_json()
    if not isinstance(items, list):
        return jsonify({'error': 'รูปแบบข้อมูลไม่ถูกต้อง'}), 400
    with get_db() as conn:
        for item in items:
            conn.execute('UPDATE categories SET sort_order=? WHERE id=?',
                         (item.get('sort_order', 0), item.get('id')))
    return jsonify({'ok': True})


# ─── Static Routes ────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR / 'public'), 'index.html')

@app.route('/admin')
def admin_page():
    return send_from_directory(str(BASE_DIR / 'public'), 'admin.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(str(UPLOAD_FOLDER), filename)


if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') == 'development'
    print(f'🚀 Prompt Gallery running at http://localhost:{port}')
    print(f'🔐 Admin panel at  http://localhost:{port}/admin')
    app.run(debug=debug, host='0.0.0.0', port=port)
