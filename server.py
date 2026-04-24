import os
import uuid
import sqlite3
import hashlib
import hmac
import base64
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
from PIL import Image
import bcrypt

BASE_DIR = Path(__file__).parent.resolve()
app = Flask(__name__, static_folder=str(BASE_DIR / 'public'), static_url_path='')

# Config — ใช้ BASE_DIR เพื่อให้ path ถูกต้องไม่ว่าจะรันจากที่ไหน
SECRET_KEY = os.environ.get('SECRET_KEY', 'prompt-gallery-secret-key-2024')
UPLOAD_FOLDER = BASE_DIR / 'public' / 'uploads'
DB_PATH = BASE_DIR / 'data' / 'database.db'
MAX_IMAGE_SIZE = (1200, 1200)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

CATEGORIES = ['All', 'Social Media', 'Infographic', 'YouTube Thumbnail', 'Comic / Storyboard',
              'Poster / Flyer', 'Product Marketing', 'Avatar / Profile', 'UI Mockup', 'Other']


# ─── Database ───────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                prompt_text TEXT NOT NULL,
                image_path TEXT,
                category TEXT NOT NULL DEFAULT 'Other',
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        ''')


init_db()


# ─── Simple JWT (no external lib needed) ────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _unb64(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + '=' * (pad % 4))


def create_token(user_id: int, username: str) -> str:
    header = _b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload = _b64(json.dumps({'sub': user_id, 'username': username,
                               'exp': int(time.time()) + 86400 * 7}).encode())
    sig = _b64(hmac.new(SECRET_KEY.encode(), f'{header}.{payload}'.encode(),
                        hashlib.sha256).digest())
    return f'{header}.{payload}.{sig}'


def verify_token(token: str):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, payload, sig = parts
        expected = _b64(hmac.new(SECRET_KEY.encode(), f'{header}.{payload}'.encode(),
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
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'กรุณาเข้าสู่ระบบ'}), 401
        request.current_user = user
        return fn(*args, **kwargs)
    return wrapper


# ─── Helpers ────────────────────────────────────────────────────────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def process_image(file) -> str:
    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f'{uuid.uuid4()}.webp'
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


# ─── Auth Routes ─────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    if not username or not password:
        return jsonify({'error': 'กรุณากรอก username และ password'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username ต้องมีอย่างน้อย 3 ตัวอักษร'}), 400
    if len(password) < 4:
        return jsonify({'error': 'Password ต้องมีอย่างน้อย 4 ตัวอักษร'}), 400

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            conn.execute('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)',
                         (username, pw_hash, now))
        with get_db() as conn:
            user = conn.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()
        token = create_token(user['id'], username)
        return jsonify({'token': token, 'username': username}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username นี้ถูกใช้ไปแล้ว'}), 409


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()

    if not user or not bcrypt.checkpw(password.encode(), user['password_hash'].encode()):
        return jsonify({'error': 'Username หรือ Password ไม่ถูกต้อง'}), 401

    token = create_token(user['id'], username)
    return jsonify({'token': token, 'username': username})


@app.route('/api/auth/me', methods=['GET'])
@require_auth
def me():
    return jsonify({'username': request.current_user['username'],
                    'sub': request.current_user['sub']})


# ─── Prompt Routes ────────────────────────────────────────────────────────────

@app.route('/api/prompts', methods=['GET'])
def list_prompts():
    category = request.args.get('category', '')
    search = request.args.get('search', '').strip()
    page = max(1, int(request.args.get('page', 1)))
    per_page = 24

    query = 'SELECT * FROM prompts WHERE 1=1'
    params = []

    if category and category != 'All':
        query += ' AND category=?'
        params.append(category)

    if search:
        query += ' AND (title LIKE ? OR description LIKE ? OR prompt_text LIKE ?)'
        s = f'%{search}%'
        params.extend([s, s, s])

    count_query = query.replace('SELECT *', 'SELECT COUNT(*)')
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params_page = params + [per_page, (page - 1) * per_page]

    with get_db() as conn:
        total = conn.execute(count_query, params).fetchone()[0]
        rows = conn.execute(query, params_page).fetchall()

    return jsonify({
        'prompts': [row_to_dict(r) for r in rows],
        'total': total,
        'page': page,
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
    title = request.form.get('title', '').strip()
    description = request.form.get('description', '').strip()
    prompt_text = request.form.get('prompt_text', '').strip()
    category = request.form.get('category', 'Other').strip()

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

    now = datetime.now(timezone.utc).isoformat()
    user = request.current_user

    with get_db() as conn:
        cursor = conn.execute(
            'INSERT INTO prompts (title, description, prompt_text, image_path, category, user_id, username, created_at) VALUES (?,?,?,?,?,?,?,?)',
            (title, description, prompt_text, image_path, category, user['sub'], user['username'], now)
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
        if row['user_id'] != user['sub']:
            return jsonify({'error': 'ไม่มีสิทธิ์ลบ prompt นี้'}), 403
        if row['image_path']:
            try:
                (UPLOAD_FOLDER / row['image_path']).unlink(missing_ok=True)
            except Exception:
                pass
        conn.execute('DELETE FROM prompts WHERE id=?', (prompt_id,))
    return jsonify({'ok': True})


@app.route('/api/categories', methods=['GET'])
def get_categories():
    return jsonify(CATEGORIES)


# ─── Static Files ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') == 'development'
    print(f'🚀 Prompt Gallery running at http://localhost:{port}')
    app.run(debug=debug, host='0.0.0.0', port=port)
