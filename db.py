"""
db.py — Database adapter
SQLite (local dev) | PostgreSQL (Railway production)

Set DATABASE_URL env var to switch to PostgreSQL automatically.
"""
import os
import re
import sqlite3
from pathlib import Path

DATABASE_URL = os.environ.get('DATABASE_URL', '')
USE_POSTGRES  = bool(DATABASE_URL)

if USE_POSTGRES:
    import psycopg2
    import psycopg2.pool
    _PG_DSN = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    _pool = None

    def _get_pool():
        global _pool
        if _pool is None:
            _pool = psycopg2.pool.ThreadedConnectionPool(1, 10, _PG_DSN)
        return _pool
else:
    _BASE   = Path(__file__).parent.resolve()
    DB_PATH = _BASE / 'data' / 'database.db'


# ── SQL translation ────────────────────────────────────────────────────────

_PRAGMA_INFO_RE    = re.compile(r'PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)\s*$', re.I)
_PRAGMA_RE         = re.compile(r'^\s*PRAGMA\b', re.I)
_AUTOINCREMENT_RE  = re.compile(r'\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b', re.I)
_INSERT_IGNORE_RE  = re.compile(r'\bINSERT\s+OR\s+IGNORE\s+INTO\b', re.I)


def _pg_sql(sql: str) -> str:
    """Translate SQLite-style SQL to PostgreSQL."""
    s = sql.strip()
    if not s:
        return s

    # PRAGMA table_info(x) → information_schema equivalent
    m = _PRAGMA_INFO_RE.match(s)
    if m:
        t = m.group(1)
        return (
            "SELECT ordinal_position-1 AS cid, column_name AS name, "
            "data_type AS type, "
            "CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull, "
            "COALESCE(column_default,'') AS dflt_value, '' AS pk "
            f"FROM information_schema.columns WHERE table_name='{t}' "
            "ORDER BY ordinal_position"
        )

    # Other PRAGMAs (journal_mode, etc.) → no-op
    if _PRAGMA_RE.match(s):
        return 'SELECT 1'

    # INSERT OR IGNORE INTO → INSERT INTO ... ON CONFLICT DO NOTHING
    had_ignore = bool(_INSERT_IGNORE_RE.search(s))
    s = _INSERT_IGNORE_RE.sub('INSERT INTO', s)

    # ? → %s
    s = s.replace('?', '%s')

    # INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
    s = _AUTOINCREMENT_RE.sub('SERIAL PRIMARY KEY', s)

    if had_ignore:
        s = s.rstrip().rstrip(';') + ' ON CONFLICT DO NOTHING'

    return s


# ── Row wrapper (sqlite3.Row-compatible) ───────────────────────────────────

class PgRow:
    """
    Wraps a psycopg2 tuple row so it works like sqlite3.Row:
      row['col']  →  value by column name
      row[0]      →  value by position
      dict(row)   →  plain dict
    """
    __slots__ = ('_keys', '_vals')

    def __init__(self, description, row_tuple):
        object.__setattr__(self, '_keys', [d[0].lower() for d in description])
        object.__setattr__(self, '_vals', list(row_tuple))

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._vals[key]
        try:
            return self._vals[self._keys.index(key.lower())]
        except ValueError:
            raise KeyError(key)

    def __contains__(self, key):
        k = key.lower() if isinstance(key, str) else key
        return k in self._keys

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def keys(self):
        return list(self._keys)

    def items(self):
        return list(zip(self._keys, self._vals))

    def __repr__(self):
        return repr(dict(self.items()))


# ── Cursor wrapper ─────────────────────────────────────────────────────────

class PgCursor:
    def __init__(self, raw_cur):
        self._cur  = raw_cur
        self.lastrowid = None

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return PgRow(self._cur.description, row)

    def fetchall(self):
        rows = self._cur.fetchall()
        if not rows:
            return []
        desc = self._cur.description
        return [PgRow(desc, r) for r in rows]

    def __iter__(self):
        desc = self._cur.description
        for row in self._cur:
            yield PgRow(desc, row)


# ── Connection wrapper ─────────────────────────────────────────────────────

class PgConn:
    """Wraps psycopg2 connection to behave like sqlite3 connection."""

    def __init__(self, raw_conn, pool=None):
        self._conn = raw_conn
        self._pool = pool
        self._closed = False

    def execute(self, sql, params=None):
        pg  = _pg_sql(sql)
        cur = self._conn.cursor()

        # Auto-inject RETURNING id so cursor.lastrowid works
        is_insert = pg.lstrip().upper().startswith('INSERT')
        if is_insert and 'RETURNING' not in pg.upper():
            pg = pg.rstrip().rstrip(';') + ' RETURNING id'

        cur.execute(pg, params or ())

        pg_cur = PgCursor(cur)
        if is_insert:
            row = cur.fetchone()          # consume RETURNING result
            if row:
                pg_cur.lastrowid = row[0]

        return pg_cur

    def executemany(self, sql, params_list):
        pg  = _pg_sql(sql)
        cur = self._conn.cursor()
        cur.executemany(pg, params_list)

    def executescript(self, script):
        """Run multiple semicolon-separated statements (sqlite3 compat)."""
        cur = self._conn.cursor()
        for stmt in script.split(';'):
            stmt = stmt.strip()
            if stmt:
                pg = _pg_sql(stmt)
                if pg and pg != 'SELECT 1':
                    cur.execute(pg)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if not self._closed:
            self._closed = True
            try:
                if self._pool:
                    self._pool.putconn(self._conn)
                else:
                    self._conn.close()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self.close()

    def __del__(self):
        self.close()


# ── Public API ─────────────────────────────────────────────────────────────

def get_db() -> 'PgConn | sqlite3.Connection':
    if USE_POSTGRES:
        raw = _get_pool().getconn()
        raw.autocommit = False
        return PgConn(raw, _get_pool())
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        return conn


# Unified exception
IntegrityError = psycopg2.IntegrityError if USE_POSTGRES else sqlite3.IntegrityError
