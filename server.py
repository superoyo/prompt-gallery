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
import io
import urllib.request
import urllib.error
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

DEFAULT_PLATFORMS = [
    {
        'name': 'OpenAI DALL-E 3', 'slug': 'openai-dalle3',
        'description': 'โมเดล text-to-image ของ OpenAI รองรับภาพคุณภาพสูง HD',
        'base_url': 'https://api.openai.com/v1/images/generations',
        'model': 'dall-e-3', 'cost_per_gen': 0.04, 'icon': '🔷', 'sort_order': 1,
        'docs_guide': '## OpenAI DALL-E 3\n\n### วิธีขอ API Key\n1. ไปที่ https://platform.openai.com/api-keys\n2. คลิก **Create new secret key**\n3. คัดลอก key มาใส่ในช่อง API Key\n\n### ราคา\n- Standard 1024×1024: **$0.040/ภาพ**\n- HD 1024×1024: **$0.080/ภาพ**\n- Wide/Tall 1024×1792: $0.080 / HD $0.120\n\n### หมายเหตุ\n- DALL-E 3 สร้างได้ **1 ภาพ** ต่อ request\n- รองรับ prompt revision อัตโนมัติ',
    },
    {
        'name': 'OpenAI GPT-Image-1', 'slug': 'openai-gpt-image-1',
        'description': 'โมเดลล่าสุดจาก OpenAI — เชี่ยวชาญ prompt ซับซ้อน, นับ token จริง',
        'base_url': 'https://api.openai.com/v1/images/generations',
        'model': 'gpt-image-1', 'cost_per_gen': 0.021, 'icon': '✨', 'sort_order': 2,
        'docs_guide': '## OpenAI GPT-Image-1\n\n### วิธีขอ API Key\n1. ไปที่ https://platform.openai.com/api-keys\n2. คลิก **Create new secret key** (ใช้ key เดียวกับ DALL-E 3)\n3. ต้องมี **Tier 1** ขึ้นไปถึงจะใช้ gpt-image-1 ได้\n\n### ราคา\n- Input text: $5.00/1M tokens\n- Output: Low ~$0.011 | Medium ~$0.021 | High ~$0.042\n\n### หมายเหตุ\n- รองรับ multimodal input\n- คุณภาพสูงกว่า DALL-E 3 สำหรับ prompt ซับซ้อน\n- ระบบจะรายงาน **token จริง** จาก API response',
    },
    {
        'name': 'Stability AI SD3.5', 'slug': 'stability-sd3',
        'description': 'Stable Diffusion 3.5 Large — detail ดีเยี่ยม aspect ratio อิสระ',
        'base_url': 'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        'model': 'sd3.5-large', 'cost_per_gen': 0.065, 'icon': '🎨', 'sort_order': 3,
        'docs_guide': '## Stability AI SD3.5\n\n### วิธีขอ API Key\n1. สมัครที่ https://platform.stability.ai/\n2. ไปที่ **Account → API Keys → Create API Key**\n\n### ราคา (Credits)\n- SD3.5 Large: **6.5 credits/ภาพ**\n- SD3.5 Large Turbo: 4 credits\n- 1,000 credits ≈ $10\n\n### หมายเหตุ\n- รองรับ aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:2, 21:9\n- ไม่รองรับ negative prompt (ใช้ SDXL แทน)',
    },
    {
        'name': 'Stability AI SDXL', 'slug': 'stability-sdxl',
        'description': 'Stable Diffusion XL 1024px — รองรับ negative prompt เต็มรูปแบบ',
        'base_url': 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        'model': 'stable-diffusion-xl-1024-v1-0', 'cost_per_gen': 0.002, 'icon': '🖼️', 'sort_order': 4,
        'docs_guide': '## Stability AI SDXL\n\n### วิธีขอ API Key\n(ใช้ key เดียวกับ SD3.5)\n1. สมัครที่ https://platform.stability.ai/\n\n### ราคา\n- ~**0.2 credits/ภาพ** (ถูกมาก)\n- 1,000 credits ≈ $10\n\n### หมายเหตุ\n- รองรับ negative prompt\n- ขนาดที่รองรับ: 1024x1024, 1152x896, 896x1152, 1344x768, 768x1344',
    },
    {
        'name': 'Ideogram v2', 'slug': 'ideogram-v2',
        'description': 'เชี่ยวชาญการใส่ข้อความในภาพ — typography ที่ดีที่สุด',
        'base_url': 'https://api.ideogram.ai/generate',
        'model': 'V_2', 'cost_per_gen': 0.08, 'icon': '💬', 'sort_order': 5,
        'docs_guide': '## Ideogram v2\n\n### วิธีขอ API Key\n1. ไปที่ https://ideogram.ai/api\n2. คลิก **Get API Key**\n\n### ราคา\n- V_2: **$0.08/ภาพ**\n- V_2_TURBO: $0.05/ภาพ\n- V_1: $0.06/ภาพ\n\n### จุดเด่น\n- **ใส่ข้อความในภาพได้แม่นยำ** (typography)\n- Magic prompt (auto-enhance)\n- รองรับ negative prompt',
    },
    {
        'name': 'Flux 1.1 Pro (Replicate)', 'slug': 'flux-replicate',
        'description': 'FLUX.1 [pro] โดย Black Forest Labs ผ่าน Replicate — คุณภาพ top tier',
        'base_url': 'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions',
        'model': 'flux-1.1-pro', 'cost_per_gen': 0.055, 'icon': '⚡', 'sort_order': 6,
        'docs_guide': '## Flux 1.1 Pro via Replicate\n\n### วิธีขอ API Key\n1. สมัครที่ https://replicate.com/\n2. ไปที่ **Account Settings → API Tokens → Create token**\n\n### ราคา\n- Flux 1.1 Pro: **$0.055/ภาพ**\n- Flux 1.1 Pro Ultra: $0.06\n- Flux Schnell (เร็ว ถูก): $0.003\n\n### หมายเหตุ\n- ผ่าน Replicate เข้าถึงโมเดลได้หลายร้อยตัว\n- รองรับ custom size อิสระ\n- ใช้ async prediction (ระบบจะ poll อัตโนมัติ)',
    },
    {
        'name': 'Leonardo AI', 'slug': 'leonardo-ai',
        'description': 'Platform creator-friendly — โมเดลและ preset หลากหลาย',
        'base_url': 'https://cloud.leonardo.ai/api/rest/v1/generations',
        'model': 'b24e16ff-06e3-43eb-8d33-4416c2d75876', 'cost_per_gen': 0.012, 'icon': '🎭', 'sort_order': 7,
        'docs_guide': '## Leonardo AI\n\n### วิธีขอ API Key\n1. สมัครที่ https://app.leonardo.ai/\n2. ไปที่ **User Settings → API Access → Create API key**\n\n### ราคา\n- ระบบ Token (credits)\n- ~150 tokens/ภาพ\n- Free plan: **150 tokens/วัน**\n\n### หมายเหตุ\n- มีโมเดลให้เลือกหลายสิบตัว\n- รองรับ ControlNet, img2img, inpainting\n- Model ID ที่ใช้: Leonardo Diffusion XL',
    },
    {
        'name': 'Midjourney', 'slug': 'midjourney',
        'description': 'โมเดล art style ระดับ top — ผ่าน third-party API wrapper',
        'base_url': 'https://api.userapi.ai/midjourney/v2', 'model': 'midjourney-v6.1',
        'cost_per_gen': 0.05, 'icon': '🌊', 'sort_order': 8,
        'docs_guide': '## Midjourney\n\n### ⚠️ สถานะ\nMidjourney **ยังไม่มี Official API** ต้องใช้ผ่าน third-party wrapper\n\n### ทางเลือก Third-party API\n1. **UseAPI.net** (https://useapi.net/) — ผ่าน Discord bot\n2. **PiAPI.ai** (https://piapi.ai/) — wrapper ยอดนิยม\n3. **GoAPI.ai** (https://goapi.ai/)\n\n### วิธีใช้ UseAPI.net\n1. สมัครที่ https://app.useapi.net/\n2. เชื่อม Discord account\n3. ต้องมี **Midjourney subscription** แยกต่างหาก\n4. สร้าง API key → ใส่ในช่องด้านบน\n\n### หมายเหตุ\n- ต้องตั้งค่า base_url ให้ตรงกับ provider ที่เลือก\n- ราคาขึ้นอยู่กับ provider + Midjourney plan',
    },
    {
        'name': 'Adobe Firefly', 'slug': 'adobe-firefly',
        'description': 'AI สร้างภาพจาก Adobe — ปลอดภัยสำหรับงานเชิงพาณิชย์',
        'base_url': 'https://firefly-api.adobe.io/v3/images/generate',
        'model': 'firefly-v3', 'cost_per_gen': 0.01, 'icon': '🔥', 'sort_order': 9,
        'docs_guide': '## Adobe Firefly API\n\n### วิธีขอ Access\n1. ไปที่ https://developer.adobe.com/firefly-api/\n2. คลิก **Get started** → สร้าง Adobe Developer Account\n3. สร้าง Project ใน Adobe Developer Console\n4. เพิ่ม **Firefly API** เข้า project\n5. สร้าง **OAuth Server-to-Server** credentials\n\n### การ Authenticate\n- ต้องแลก Client ID + Client Secret → Access Token\n- ใส่ Client ID ในช่อง API Key\n- ใส่ Client Secret ใน Extra Config: `{"client_secret": "..."}`\n\n### ราคา\n- Free: 25 generative credits/เดือน\n- credits แยกจาก Creative Cloud\n\n### จุดเด่น\n- **ปลอดภัย 100% สำหรับงานการค้า** (trained on licensed content)',
    },
    {
        'name': 'Google Imagen 3', 'slug': 'google-imagen3',
        'description': 'โมเดลจาก Google DeepMind — ผ่าน Vertex AI หรือ Gemini API',
        'base_url': 'https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/imagegeneration@006:predict',
        'model': 'imagen-3.0-generate-001', 'cost_per_gen': 0.02, 'icon': '🌐', 'sort_order': 10,
        'docs_guide': '## Google Imagen 3\n\n### ทางเลือก 1: Gemini API (ง่ายกว่า)\n1. ไปที่ https://aistudio.google.com/apikey\n2. คลิก **Create API key**\n3. ใส่ key ในช่อง API Key\n4. ตั้ง base_url เป็น: `https://generativelanguage.googleapis.com/v1beta`\n\n### ทางเลือก 2: Vertex AI\n1. มี Google Cloud Project พร้อม billing\n2. เปิด **Vertex AI API**\n3. สร้าง **Service Account** ที่มีสิทธิ์ `Vertex AI User`\n4. ดาวน์โหลด JSON key file\n5. ใส่ JSON content ใน Extra Config: `{"service_account_json": {...}}`\n\n### ราคา\n- $0.02/ภาพ (1024×1024)\n\n### หมายเหตุ\n- ต้องขอ access Imagen 3 ที่ https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview',
    },
]

def _seed_platforms():
    """Seed DEFAULT_PLATFORMS if ai_platforms table is empty"""
    with get_db() as conn:
        count = conn.execute('SELECT COUNT(*) FROM ai_platforms').fetchone()[0]
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            for p in DEFAULT_PLATFORMS:
                conn.execute(
                    '''INSERT OR IGNORE INTO ai_platforms
                       (name, slug, description, api_key, base_url, model,
                        is_enabled, is_visible, sort_order, cost_per_gen,
                        icon, docs_guide, extra_config, created_at)
                       VALUES (?,?,?,?,?,?,0,1,?,?,?,?,?,?)''',
                    (p['name'], p['slug'], p.get('description',''),
                     '', p.get('base_url',''), p.get('model',''),
                     p.get('sort_order', 99),
                     float(p.get('cost_per_gen', 0)),
                     p.get('icon','🤖'), p.get('docs_guide',''), '{}', now)
                )


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
            CREATE TABLE IF NOT EXISTS ai_platforms (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                slug        TEXT UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                api_key     TEXT DEFAULT '',
                base_url    TEXT DEFAULT '',
                model       TEXT DEFAULT '',
                is_enabled  INTEGER DEFAULT 0,
                is_visible  INTEGER DEFAULT 1,
                sort_order  INTEGER DEFAULT 0,
                cost_per_gen REAL DEFAULT 0.0,
                icon        TEXT DEFAULT '🤖',
                docs_guide      TEXT DEFAULT '',
                extra_config    TEXT DEFAULT '{}',
                enabled_models  TEXT DEFAULT '[]',
                created_at      TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS prompt_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL,
                platform_slug   TEXT NOT NULL,
                platform_name   TEXT NOT NULL,
                prompt_text     TEXT NOT NULL,
                negative_prompt TEXT DEFAULT '',
                model           TEXT DEFAULT '',
                result_image_path TEXT DEFAULT '',
                status          TEXT DEFAULT 'pending',
                error_msg       TEXT DEFAULT '',
                gen_count       INTEGER DEFAULT 1,
                tokens_used     INTEGER DEFAULT 0,
                cost_usd        REAL DEFAULT 0.0,
                created_at      TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        ''')
        # migrate existing users table (add columns if missing)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
        for col, definition in [
            ('email',         'TEXT'),
            ('is_admin',      'INTEGER NOT NULL DEFAULT 0'),
            ('is_disabled',   'INTEGER NOT NULL DEFAULT 0'),
            ('last_login_at', 'TEXT'),
        ]:
            if col not in cols:
                conn.execute(f'ALTER TABLE users ADD COLUMN {col} {definition}')

        # migrate ai_platforms table
        pcols = {r[1] for r in conn.execute("PRAGMA table_info(ai_platforms)")}
        for col, definition in [
            ('enabled_models', "TEXT DEFAULT '[]'"),
        ]:
            if col not in pcols:
                conn.execute(f'ALTER TABLE ai_platforms ADD COLUMN {col} {definition}')

    _ensure_super_admin()
    _seed_categories()
    _seed_platforms()
    _patch_google_imagen_docs()


def _patch_google_imagen_docs():
    """อัปเดต docs_guide ของ google-imagen3 ให้ถูกต้อง"""
    new_guide = (
        '## Google Image Generation (AI Studio)\n\n'
        '### วิธีขอ API Key\n'
        '1. ไปที่ **https://aistudio.google.com/apikey**\n'
        '2. คลิก **Create API key**\n'
        '3. คัดลอก key (ขึ้นต้นด้วย `AIza...`) มาใส่ในช่อง API Key ✅\n\n'
        '### โมเดลที่ระบบลองตามลำดับ\n'
        '1. `gemini-2.0-flash-preview-image-generation` — native image gen (แนะนำ)\n'
        '2. `gemini-2.0-flash-exp` — experimental multimodal\n'
        '3. `imagen-3.0-generate-001` — Imagen 3 (ถ้า account มีสิทธิ์)\n\n'
        '### ราคา\n'
        '- **ฟรี** ใน Free tier (gemini-2.0-flash)\n'
        '- Imagen 3: ~$0.02/ภาพ\n\n'
        '### หมายเหตุ\n'
        '- ไม่ต้องสร้าง GCP Project หรือ Service Account\n'
        '- ถ้า error 404: key ยังไม่ได้เปิดใช้ Image Generation\n'
        '  → ไปที่ https://aistudio.google.com แล้วลอง generate ภาพสักครั้งก่อน\n'
        '- ถ้าต้องการ Imagen 3 โดยเฉพาะ: ต้องมี Google Cloud billing account'
    )
    with get_db() as conn:
        conn.execute(
            "UPDATE ai_platforms SET docs_guide=? WHERE slug='google-imagen3'",
            (new_guide,)
        )


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


# ─── AI Platform Helpers ──────────────────────────────────────────────────────

SIZE_MAP = {
    '1:1':  {'openai': '1024x1024', 'sd3_ar': '1:1',   'sdxl': '1024x1024',
             'ideogram': 'RESOLUTION_1024_1024', 'rw': 1024, 'rh': 1024},
    '16:9': {'openai': '1792x1024', 'sd3_ar': '16:9',  'sdxl': '1344x768',
             'ideogram': 'RESOLUTION_1344_768',  'rw': 1344, 'rh': 768},
    '9:16': {'openai': '1024x1792', 'sd3_ar': '9:16',  'sdxl': '768x1344',
             'ideogram': 'RESOLUTION_768_1344',  'rw': 768,  'rh': 1344},
    '4:3':  {'openai': '1792x1024', 'sd3_ar': '4:3',   'sdxl': '1152x896',
             'ideogram': 'RESOLUTION_1152_896',  'rw': 1152, 'rh': 896},
}

def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text.split()) * 1.33))

def _http_post_json(url, payload, headers):
    body = json.dumps(payload).encode('utf-8')
    req_headers = {'Content-Type': 'application/json', **headers}
    req = urllib.request.Request(url, data=body, headers=req_headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')
        try:
            j = json.loads(err)
            msg = j.get('error', err)
            if isinstance(msg, dict):
                msg = msg.get('message', err)
        except Exception:
            msg = err[:300]
        raise Exception(f'HTTP {e.code}: {msg}')

def _http_post_multipart(url, fields, headers):
    boundary = uuid.uuid4().hex
    body = b''
    for name, value in fields.items():
        body += (f'--{boundary}\r\nContent-Disposition: form-data; '
                 f'name="{name}"\r\n\r\n{value}\r\n').encode('utf-8')
    body += f'--{boundary}--\r\n'.encode('utf-8')
    req_headers = {'Content-Type': f'multipart/form-data; boundary={boundary}', **headers}
    req = urllib.request.Request(url, data=body, headers=req_headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise Exception(f'HTTP {e.code}: {e.read().decode("utf-8", errors="replace")[:300]}')

def _save_b64_image(b64_data: str) -> str:
    import base64 as _b64
    filename = f'{uuid.uuid4()}.webp'
    save_path = UPLOAD_FOLDER / filename
    img_bytes = _b64.b64decode(b64_data)
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode in ('RGBA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        bg.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
        img = bg
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(save_path, 'WEBP', quality=85)
    return filename

def _save_url_image(image_url: str) -> str:
    filename = f'{uuid.uuid4()}.webp'
    save_path = UPLOAD_FOLDER / filename
    req = urllib.request.Request(image_url, headers={'User-Agent': 'PromptGallery/1.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        img_bytes = resp.read()
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode in ('RGBA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        bg.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
        img = bg
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(save_path, 'WEBP', quality=85)
    return filename

def _save_raw_image(raw_bytes: bytes) -> str:
    filename = f'{uuid.uuid4()}.webp'
    save_path = UPLOAD_FOLDER / filename
    img = Image.open(io.BytesIO(raw_bytes))
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')
    if img.mode == 'RGBA':
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    img.save(save_path, 'WEBP', quality=85)
    return filename

def _gen_openai(api_key, model, prompt, size_key, quality):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    data = {'model': model, 'prompt': prompt, 'n': 1, 'size': sm['openai']}
    if model == 'dall-e-3':
        data['quality'] = 'hd' if quality == 'high' else 'standard'
        data['response_format'] = 'b64_json'
        cost = (0.12 if sm['openai'] != '1024x1024' else 0.08) if quality == 'high' else \
               (0.08 if sm['openai'] != '1024x1024' else 0.04)
        tokens = 0
    else:
        q = {'standard': 'medium', 'high': 'high', 'low': 'low'}.get(quality, 'medium')
        data['quality'] = q
        cost = {'low': 0.011, 'medium': 0.021, 'high': 0.042}.get(q, 0.021)
        tokens = 0
    result = _http_post_json(
        'https://api.openai.com/v1/images/generations',
        data, {'Authorization': f'Bearer {api_key}'}
    )
    if 'usage' in result:
        u = result['usage']
        tokens = u.get('input_tokens', 0) + u.get('output_tokens', 0)
    item = result['data'][0]
    b64 = item.get('b64_json')
    filename = _save_b64_image(b64) if b64 else _save_url_image(item['url'])
    return filename, cost, tokens

def _gen_stability_sd3(api_key, prompt, neg_prompt, size_key):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    fields = {'prompt': prompt, 'aspect_ratio': sm['sd3_ar'],
              'output_format': 'webp', 'model': 'sd3.5-large'}
    if neg_prompt:
        fields['negative_prompt'] = neg_prompt
    raw = _http_post_multipart(
        'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        fields, {'authorization': f'Bearer {api_key}', 'accept': 'image/*'}
    )
    return _save_raw_image(raw), 0.065, 0

def _gen_stability_sdxl(api_key, prompt, neg_prompt, size_key):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    w, h = map(int, sm['sdxl'].split('x'))
    payload = {
        'text_prompts': [{'text': prompt, 'weight': 1.0}],
        'cfg_scale': 7, 'height': h, 'width': w, 'samples': 1, 'steps': 30,
    }
    if neg_prompt:
        payload['text_prompts'].append({'text': neg_prompt, 'weight': -1.0})
    result = _http_post_json(
        'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        payload, {'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'}
    )
    return _save_b64_image(result['artifacts'][0]['base64']), 0.002, 0

def _gen_ideogram(api_key, prompt, neg_prompt, size_key):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    req_body = {'image_request': {
        'prompt': prompt, 'model': 'V_2',
        'resolution': sm['ideogram'], 'magic_prompt_option': 'OFF',
    }}
    if neg_prompt:
        req_body['image_request']['negative_prompt'] = neg_prompt
    result = _http_post_json('https://api.ideogram.ai/generate',
                             req_body, {'Api-Key': api_key})
    return _save_url_image(result['data'][0]['url']), 0.08, 0

def _gen_flux_replicate(api_key, prompt, size_key):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    payload = {'input': {'prompt': prompt, 'width': sm['rw'], 'height': sm['rh'],
                         'output_format': 'webp', 'output_quality': 85}}
    result = _http_post_json(
        'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions',
        payload, {'Authorization': f'Bearer {api_key}', 'Prefer': 'wait=60'}
    )
    def _get_output(r):
        out = r.get('output')
        return out[0] if isinstance(out, list) else out
    if result.get('status') == 'succeeded':
        return _save_url_image(_get_output(result)), 0.055, 0
    poll_url = result['urls']['get']
    for _ in range(30):
        time.sleep(3)
        req2 = urllib.request.Request(poll_url, headers={'Authorization': f'Bearer {api_key}'})
        with urllib.request.urlopen(req2, timeout=30) as resp:
            result = json.loads(resp.read())
        if result.get('status') == 'succeeded':
            return _save_url_image(_get_output(result)), 0.055, 0
        if result.get('status') == 'failed':
            raise Exception(result.get('error', 'Flux generation failed'))
    raise Exception('Flux generation timed out (90s)')

def _gen_leonardo(api_key, prompt, neg_prompt, size_key):
    sm = SIZE_MAP.get(size_key, SIZE_MAP['1:1'])
    payload = {
        'prompt': prompt,
        'modelId': 'b24e16ff-06e3-43eb-8d33-4416c2d75876',
        'width': sm['rw'], 'height': sm['rh'], 'num_images': 1,
    }
    if neg_prompt:
        payload['negative_prompt'] = neg_prompt
    result = _http_post_json('https://cloud.leonardo.ai/api/rest/v1/generations',
                             payload, {'authorization': f'Bearer {api_key}'})
    gen_id = result['sdGenerationJob']['generationId']
    for _ in range(30):
        time.sleep(3)
        req = urllib.request.Request(
            f'https://cloud.leonardo.ai/api/rest/v1/generations/{gen_id}',
            headers={'authorization': f'Bearer {api_key}'}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            poll = json.loads(resp.read())
        gen = poll.get('generations_by_pk', {})
        if gen.get('status') == 'COMPLETE':
            imgs = gen.get('generated_images', [])
            if imgs:
                return _save_url_image(imgs[0]['url']), 0.012, 0
            raise Exception('Leonardo: no image in response')
        if gen.get('status') == 'FAILED':
            raise Exception('Leonardo generation failed')
    raise Exception('Leonardo generation timed out (90s)')

def _gen_google_imagen(api_key: str, prompt: str, size_key: str, model_override: str = None):
    """
    Google Image Generation ผ่าน Gemini Developer API (AI Studio key AIza...)
    ถ้า model_override ระบุ จะใช้โมเดลนั้นโดยตรง มิฉะนั้นลองตามลำดับ:
      1. gemini-2.0-flash-preview-image-generation
      2. gemini-2.0-flash-exp
      3. gemini-2.0-flash  (with responseModalities IMAGE+TEXT)
    หมายเหตุ: `:predict` endpoint ใช้ได้เฉพาะ Vertex AI (Service Account) ไม่ใช่ AI Studio key
    """
    BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

    def _extract_image_from_gc(result: dict):
        for cand in result.get('candidates', []):
            for part in cand.get('content', {}).get('parts', []):
                if 'inlineData' in part:
                    data = part['inlineData'].get('data', '')
                    if data:
                        return data
        return None

    # modality combinations to try (order matters for some models)
    MODALITY_SETS = [
        ['IMAGE'],
        ['TEXT', 'IMAGE'],
        ['IMAGE', 'TEXT'],
    ]

    if model_override:
        # ลองทุก modality combination กับโมเดลที่ระบุ
        models_to_try = [(model_override, m) for m in MODALITY_SETS]
    else:
        models_to_try = [
            ('gemini-2.0-flash-preview-image-generation', ['IMAGE']),
            ('gemini-2.0-flash-exp',                      ['IMAGE', 'TEXT']),
            ('gemini-2.0-flash',                          ['IMAGE', 'TEXT']),
        ]

    last_raw_snippet = ''
    errors = {}
    for model_name, modalities in models_to_try:
        attempt_key = f'{model_name} [{",".join(modalities)}]'
        try:
            url = f'{BASE}/{model_name}:generateContent?key={api_key}'
            payload = {
                'contents': [{'parts': [{'text': prompt}]}],
                'generationConfig': {'responseModalities': modalities},
            }
            result = _http_post_json(url, payload, {})
            b64 = _extract_image_from_gc(result)
            if b64:
                return _save_b64_image(b64), 0.02, _estimate_tokens(prompt)
            # ได้ response แต่ไม่มีภาพ — เก็บ snippet ไว้ debug
            import json as _json
            last_raw_snippet = _json.dumps(result, ensure_ascii=False)[:300]
            errors[attempt_key] = f'response OK แต่ไม่มี image data'
        except Exception as exc:
            errors[attempt_key] = str(exc)[:200]

    # ทุก combination ล้มเหลว
    err_lines = '\n'.join(f'  • {k}: {v}' for k, v in errors.items())
    hint = f'\nResponse snippet: {last_raw_snippet}' if last_raw_snippet else ''
    raise Exception(
        f'Google Gemini: ไม่สามารถสร้างภาพได้ ลองแล้ว {len(errors)} วิธี:\n'
        f'{err_lines}{hint}'
    )


def _call_platform_api(platform, prompt, neg_prompt, size_key, quality, model_override=None):
    """Route to correct generator. Returns (filename, cost_usd, tokens)."""
    s = platform['slug']
    k = platform['api_key']
    if s == 'openai-dalle3':        return _gen_openai(k, 'dall-e-3', prompt, size_key, quality)
    if s == 'openai-gpt-image-1':   return _gen_openai(k, 'gpt-image-1', prompt, size_key, quality)
    if s == 'stability-sd3':        return _gen_stability_sd3(k, prompt, neg_prompt, size_key)
    if s == 'stability-sdxl':       return _gen_stability_sdxl(k, prompt, neg_prompt, size_key)
    if s == 'ideogram-v2':          return _gen_ideogram(k, prompt, neg_prompt, size_key)
    if s == 'flux-replicate':       return _gen_flux_replicate(k, prompt, size_key)
    if s == 'leonardo-ai':          return _gen_leonardo(k, prompt, neg_prompt, size_key)
    if s == 'google-imagen3':       return _gen_google_imagen(k, prompt, size_key, model_override)
    raise Exception(f'Platform "{s}" ยังไม่รองรับการ generate อัตโนมัติ — ใช้งานบน platform นั้นโดยตรง')


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


# ─── Public Platform Routes ───────────────────────────────────────────────────

@app.route('/api/platforms', methods=['GET'])
def get_platforms():
    with get_db() as conn:
        q = ('SELECT id,name,slug,description,icon,is_enabled,is_visible,sort_order,model,cost_per_gen,enabled_models '
             'FROM ai_platforms WHERE is_visible=1 AND is_enabled=1 ORDER BY sort_order, name')
        rows = conn.execute(q).fetchall()
    result = []
    for r in rows:
        d = row_to_dict(r)
        try:
            d['enabled_models'] = json.loads(d.get('enabled_models') or '[]')
        except Exception:
            d['enabled_models'] = []
        result.append(d)
    return jsonify(result)


# ─── Prompt Lab Routes ────────────────────────────────────────────────────────

@app.route('/api/lab/generate', methods=['POST'])
@require_auth
def lab_generate():
    data           = request.get_json() or {}
    prompt_text    = (data.get('prompt') or '').strip()
    slugs          = data.get('platforms', [])
    neg_prompt     = (data.get('negative_prompt') or '').strip()
    size_key       = data.get('size', '1:1')
    quality        = data.get('quality', 'standard')
    model_override = (data.get('model') or '').strip() or None

    if not prompt_text:
        return jsonify({'error': 'กรุณาใส่ prompt'}), 400
    if not slugs:
        return jsonify({'error': 'กรุณาเลือก AI platform อย่างน้อย 1 ตัว'}), 400
    if len(slugs) > 5:
        return jsonify({'error': 'เลือกได้สูงสุด 5 platform ต่อครั้ง'}), 400

    user    = request.current_user
    now     = datetime.now(timezone.utc).isoformat()
    results = []

    for slug in slugs:
        with get_db() as conn:
            platform = conn.execute(
                'SELECT * FROM ai_platforms WHERE slug=? AND is_visible=1', (slug,)
            ).fetchone()

        if not platform:
            results.append({'slug': slug, 'status': 'error', 'error': 'ไม่พบ platform'})
            continue

        tokens = _estimate_tokens(prompt_text + ' ' + neg_prompt)

        if not platform['api_key']:
            with get_db() as conn:
                conn.execute(
                    '''INSERT INTO prompt_history
                       (user_id,platform_slug,platform_name,prompt_text,negative_prompt,
                        model,status,error_msg,gen_count,tokens_used,cost_usd,created_at)
                       VALUES(?,?,?,?,?,?,'failed',?,1,0,0,?)''',
                    (user['sub'], slug, platform['name'], prompt_text, neg_prompt,
                     platform['model'], 'ยังไม่ได้ตั้งค่า API Key', now)
                )
            results.append({'slug': slug, 'name': platform['name'],
                            'status': 'error', 'error': f'"{platform["name"]}" ยังไม่ได้ตั้งค่า API Key'})
            continue

        try:
            filename, cost, api_tokens = _call_platform_api(
                dict(platform), prompt_text, neg_prompt, size_key, quality, model_override
            )
            if api_tokens > 0:
                tokens = api_tokens
            with get_db() as conn:
                conn.execute(
                    '''INSERT INTO prompt_history
                       (user_id,platform_slug,platform_name,prompt_text,negative_prompt,
                        model,result_image_path,status,gen_count,tokens_used,cost_usd,created_at)
                       VALUES(?,?,?,?,?,?,?,'success',1,?,?,?)''',
                    (user['sub'], slug, platform['name'], prompt_text, neg_prompt,
                     platform['model'], filename, tokens, cost, now)
                )
            results.append({
                'slug': slug, 'name': platform['name'], 'icon': platform['icon'],
                'status': 'success',
                'image_path': f'/uploads/{filename}',
                'tokens_used': tokens, 'cost_usd': cost
            })
        except Exception as exc:
            with get_db() as conn:
                conn.execute(
                    '''INSERT INTO prompt_history
                       (user_id,platform_slug,platform_name,prompt_text,negative_prompt,
                        model,status,error_msg,gen_count,tokens_used,cost_usd,created_at)
                       VALUES(?,?,?,?,?,?,'failed',?,1,?,0,?)''',
                    (user['sub'], slug, platform['name'], prompt_text, neg_prompt,
                     platform['model'], str(exc)[:500], tokens, now)
                )
            results.append({'slug': slug, 'name': platform['name'], 'icon': platform['icon'],
                            'status': 'error', 'error': str(exc)[:300]})

    return jsonify({'results': results})


@app.route('/api/lab/history', methods=['GET'])
@require_auth
def lab_history():
    user     = request.current_user
    page     = max(1, int(request.args.get('page', 1)))
    per_page = 20
    platform = request.args.get('platform', '')

    query  = 'SELECT * FROM prompt_history WHERE user_id=?'
    params = [user['sub']]
    if platform:
        query += ' AND platform_slug=?'
        params.append(platform)
    count_q = query.replace('SELECT *', 'SELECT COUNT(*)')
    query  += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

    with get_db() as conn:
        total = conn.execute(count_q, params).fetchone()[0]
        rows  = conn.execute(query, params + [per_page, (page-1)*per_page]).fetchall()

    return jsonify({
        'history': [row_to_dict(r) for r in rows],
        'total': total, 'page': page,
        'pages': (total + per_page - 1) // per_page
    })


@app.route('/api/lab/stats', methods=['GET'])
@require_auth
def lab_stats():
    user = request.current_user
    with get_db() as conn:
        rows = conn.execute('''
            SELECT platform_slug, platform_name,
                   COUNT(*) AS total_gens,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_gens,
                   SUM(tokens_used) AS total_tokens,
                   ROUND(SUM(cost_usd),4) AS total_cost,
                   MAX(created_at) AS last_used
            FROM prompt_history WHERE user_id=?
            GROUP BY platform_slug ORDER BY total_gens DESC
        ''', (user['sub'],)).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


# ─── Admin Platform Routes ────────────────────────────────────────────────────

@app.route('/api/admin/platforms', methods=['GET'])
@require_admin
def admin_list_platforms():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT * FROM ai_platforms ORDER BY sort_order, name'
        ).fetchall()
    result = []
    for r in rows:
        d = row_to_dict(r)
        key = d.get('api_key', '')
        d['api_key_masked'] = ('••••••' + key[-6:]) if len(key) > 6 else ('••' if key else '')
        d['has_key'] = bool(key.strip())
        d.pop('api_key', None)
        try:
            d['enabled_models'] = json.loads(d.get('enabled_models') or '[]')
        except Exception:
            d['enabled_models'] = []
        result.append(d)
    return jsonify(result)


@app.route('/api/admin/platforms', methods=['POST'])
@require_admin
def admin_create_platform():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    slug = (data.get('slug') or '').strip().lower().replace(' ', '-')
    if not name or not slug:
        return jsonify({'error': 'กรุณากรอก name และ slug'}), 400
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        mo = conn.execute('SELECT COALESCE(MAX(sort_order),0) FROM ai_platforms').fetchone()[0]
        try:
            cur = conn.execute(
                '''INSERT INTO ai_platforms
                   (name,slug,description,api_key,base_url,model,is_enabled,is_visible,
                    sort_order,cost_per_gen,icon,docs_guide,extra_config,created_at)
                   VALUES(?,?,?,?,?,?,0,1,?,?,?,?,?,?)''',
                (name, slug, data.get('description',''), data.get('api_key',''),
                 data.get('base_url',''), data.get('model',''), mo+1,
                 float(data.get('cost_per_gen',0)), data.get('icon','🤖'),
                 data.get('docs_guide',''), data.get('extra_config','{}'), now)
            )
            pid = cur.lastrowid
        except sqlite3.IntegrityError:
            return jsonify({'error': f'Slug "{slug}" ซ้ำกับ platform อื่น'}), 409
    with get_db() as conn:
        row = conn.execute('SELECT * FROM ai_platforms WHERE id=?', (pid,)).fetchone()
    d = row_to_dict(row)
    d.pop('api_key', None)
    return jsonify(d), 201


@app.route('/api/admin/platforms/<int:pid>', methods=['PATCH'])
@require_admin
def admin_update_platform(pid):
    data = request.get_json() or {}
    with get_db() as conn:
        row = conn.execute('SELECT * FROM ai_platforms WHERE id=?', (pid,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ platform'}), 404
        fields = {}
        for k in ('name', 'description', 'base_url', 'model', 'icon',
                  'docs_guide', 'extra_config'):
            if k in data:
                fields[k] = data[k]
        if 'api_key' in data:
            fields['api_key']    = data['api_key']
            fields['is_enabled'] = 1 if data['api_key'].strip() else 0
        if 'is_visible'    in data: fields['is_visible']    = int(data['is_visible'])
        if 'cost_per_gen'  in data: fields['cost_per_gen']  = float(data['cost_per_gen'])
        if 'enabled_models' in data:
            em = data['enabled_models']
            fields['enabled_models'] = json.dumps(em if isinstance(em, list) else [])
        if fields:
            set_cl = ', '.join(f'{k}=?' for k in fields)
            conn.execute(f'UPDATE ai_platforms SET {set_cl} WHERE id=?',
                         list(fields.values()) + [pid])
    return jsonify({'ok': True})


@app.route('/api/admin/platforms/<int:pid>/toggle-visible', methods=['PATCH'])
@require_admin
def admin_toggle_platform_visible(pid):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM ai_platforms WHERE id=?', (pid,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ platform'}), 404
        ns = 0 if row['is_visible'] else 1
        conn.execute('UPDATE ai_platforms SET is_visible=? WHERE id=?', (ns, pid))
    return jsonify({'ok': True, 'is_visible': bool(ns)})


@app.route('/api/admin/platforms/<int:pid>', methods=['DELETE'])
@require_admin
def admin_delete_platform(pid):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM ai_platforms WHERE id=?', (pid,)).fetchone()
        if not row:
            return jsonify({'error': 'ไม่พบ platform'}), 404
        conn.execute('DELETE FROM ai_platforms WHERE id=?', (pid,))
    return jsonify({'ok': True})


@app.route('/api/admin/lab/stats', methods=['GET'])
@require_admin
def admin_lab_stats():
    with get_db() as conn:
        rows = conn.execute('''
            SELECT platform_slug, platform_name,
                   COUNT(*) AS total_gens,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_gens,
                   SUM(tokens_used) AS total_tokens,
                   ROUND(SUM(cost_usd),4) AS total_cost,
                   COUNT(DISTINCT user_id) AS unique_users,
                   MAX(created_at) AS last_used
            FROM prompt_history
            GROUP BY platform_slug ORDER BY total_gens DESC
        ''').fetchall()
    return jsonify([row_to_dict(r) for r in rows])


# ─── Static Routes ────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR / 'public'), 'index.html')

@app.route('/admin')
def admin_page():
    return send_from_directory(str(BASE_DIR / 'public'), 'admin.html')

@app.route('/prompt-lab')
def prompt_lab_page():
    return send_from_directory(str(BASE_DIR / 'public'), 'prompt-lab.html')

@app.route('/google-test')
def google_test_page():
    return send_from_directory(str(BASE_DIR / 'public'), 'google-test.html')


# ─── Google AI Studio Test Route ─────────────────────────────────────────────

@app.route('/api/test/google-list-models', methods=['POST'])
def test_google_list_models():
    """ดึงรายชื่อ model ทั้งหมดจาก Google Generative Language API
    รับ api_key = '__use_saved__' เพื่อใช้ key ที่บันทึกใน DB ของ google-imagen3
    """
    data    = request.get_json() or {}
    api_key = (data.get('api_key') or '').strip()

    # ใช้ saved key จาก DB (admin เรียกจาก Settings)
    if api_key == '__use_saved__':
        # ต้องเป็น admin เท่านั้น
        token = request.headers.get('Authorization', '').replace('Bearer ', '').strip()
        user  = verify_token(token)
        if not user or not user.get('is_admin'):
            return jsonify({'ok': False, 'error': 'ต้องเป็น Admin'}), 403
        with get_db() as conn:
            row = conn.execute("SELECT api_key FROM ai_platforms WHERE slug='google-imagen3'").fetchone()
        api_key = (row['api_key'] if row else '').strip()

    if not api_key:
        return jsonify({'ok': False, 'error': 'ไม่มี API Key — กรุณาบันทึก API Key สำหรับ Google Imagen ก่อน'}), 400

    url = f'https://generativelanguage.googleapis.com/v1beta/models?key={api_key}&pageSize=200'
    req = urllib.request.Request(url, headers={'Content-Type': 'application/json'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')[:400]
        return jsonify({'ok': False, 'error': f'HTTP {e.code}: {err}'}), 400
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500

    models = result.get('models', [])
    return jsonify({'ok': True, 'models': models})


@app.route('/api/test/google-imagen', methods=['POST'])
def test_google_imagen():
    """
    หน้าทดสอบ Google AI Studio — ลอง model ต่าง ๆ แล้วส่งผลกลับพร้อม debug info
    """
    data        = request.get_json() or {}
    api_key     = (data.get('api_key') or '').strip()
    model_req   = (data.get('model')   or 'gemini-2.0-flash-exp').strip()
    prompt_text = (data.get('prompt')  or '').strip()
    aspect_ratio = data.get('aspect_ratio', '1:1')
    sample_count = min(4, max(1, int(data.get('sample_count', 1))))

    if not api_key:
        return jsonify({'ok': False, 'error': 'ไม่มี API Key'}), 400
    if not prompt_text:
        return jsonify({'ok': False, 'error': 'ไม่มี prompt'}), 400

    BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

    # ─── helper: extract base64 from generateContent response ───
    def _extract_gc_images(result: dict):
        images = []
        for cand in result.get('candidates', []):
            for part in cand.get('content', {}).get('parts', []):
                if 'inlineData' in part:
                    b64 = part['inlineData'].get('data', '')
                    if b64:
                        images.append(b64)
        return images

    # ─── helper: extract base64 from predict (Imagen) response ──
    def _extract_predict_images(result: dict):
        images = []
        for pred in result.get('predictions', []):
            b64 = pred.get('bytesBase64Encoded', '')
            if b64:
                images.append(b64)
        return images

    # ─── Gemini generateContent models ──────────────────────────
    GEMINI_MODELS = [
        'gemini-2.0-flash-exp',
        'gemini-2.5-flash',
        'gemini-2.5-flash-preview-05-20',
        'gemini-2.5-flash-preview-04-17',
    ]

    # ─── Imagen predict models ───────────────────────────────────
    IMAGEN_MODELS = [
        'imagen-4.0-generate-001',
        'imagen-4.0-fast-generate-001',
        'imagen-3.0-generate-002',
        'imagen-3.0-generate-001',
    ]

    def try_gemini(model_name):
        # generateContent ไม่รองรับ sampleCount — ต้องเรียกหลายครั้งเอง
        url = f'{BASE}/{model_name}:generateContent?key={api_key}'
        payload = {
            'contents': [{'parts': [{'text': prompt_text}]}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE']},
        }
        req_info = {'method': 'POST', 'url': url.replace(api_key, '***'), 'body': payload,
                    'note': f'called {sample_count}x (generateContent does not support sampleCount)'}
        all_images = []
        last_result = {}
        for _ in range(sample_count):
            last_result = _http_post_json(url, payload, {})
            all_images.extend(_extract_gc_images(last_result))
        return all_images, req_info, last_result

    def try_imagen(model_name):
        url = f'{BASE}/{model_name}:predict?key={api_key}'
        payload = {
            'instances': [{'prompt': prompt_text}],
            'parameters': {
                'sampleCount': sample_count,
                'aspectRatio': aspect_ratio,
            },
        }
        req_info = {'method': 'POST', 'url': url.replace(api_key, '***'), 'body': payload}
        result   = _http_post_json(url, payload, {})
        images   = _extract_predict_images(result)
        return images, req_info, result

    # ─── Decide which models to run ──────────────────────────────
    if model_req == '__auto__':
        models_to_try = [('gemini', m) for m in GEMINI_MODELS] + \
                        [('imagen', m) for m in IMAGEN_MODELS]
    elif model_req in GEMINI_MODELS or model_req.startswith('gemini-'):
        models_to_try = [('gemini', model_req)]
    else:
        models_to_try = [('imagen', model_req)]

    # ─── Try each model ──────────────────────────────────────────
    attempts = []
    for kind, mname in models_to_try:
        try:
            if kind == 'gemini':
                images, req_info, raw = try_gemini(mname)
            else:
                images, req_info, raw = try_imagen(mname)

            # truncate raw response for debug (images can be huge)
            raw_debug = json.loads(json.dumps(raw))
            _truncate_b64_in_debug(raw_debug)

            if images:
                attempts.append({'model': mname, 'status': 'ok', 'request': req_info, 'response_summary': raw_debug})
                return jsonify({
                    'ok': True,
                    'model_used': mname,
                    'images': images,
                    'debug': {'attempts': attempts}
                })
            else:
                attempts.append({'model': mname, 'status': 'no_image',
                                  'request': req_info, 'response_summary': raw_debug})
        except Exception as exc:
            err_str = str(exc)[:500]
            attempts.append({'model': mname, 'status': 'error', 'error': err_str})

    # All failed
    err_summary = '\n'.join(
        f'• {a["model"]}: {a.get("error") or a.get("status")}' for a in attempts
    )
    return jsonify({
        'ok': False,
        'error': f'ทดสอบแล้ว {len(attempts)} model ทั้งหมดล้มเหลว:\n{err_summary}',
        'debug': {'attempts': attempts}
    })


def _truncate_b64_in_debug(obj, max_len=80):
    """ตัด base64 ที่ยาวใน dict/list เพื่อแสดงใน debug โดยไม่ล้น"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and len(v) > max_len and k in ('data', 'bytesBase64Encoded'):
                obj[k] = v[:max_len] + f'... [{len(v)} chars]'
            else:
                _truncate_b64_in_debug(v, max_len)
    elif isinstance(obj, list):
        for item in obj:
            _truncate_b64_in_debug(item, max_len)


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(str(UPLOAD_FOLDER), filename)


if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') == 'development'
    print(f'🚀 Prompt Gallery running at http://localhost:{port}')
    print(f'🔐 Admin panel at  http://localhost:{port}/admin')
    app.run(debug=debug, host='0.0.0.0', port=port)
