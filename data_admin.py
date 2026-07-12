import os
from datetime import datetime
from pathlib import Path

from flask import Blueprint, abort, jsonify, request, send_from_directory, send_file

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "hazards.db"
UPLOAD_DIR = DATA_DIR / "uploads"
ALERT_DATA_FILE = DATA_DIR / "alert_台账.xlsx"
ALERT_SEED_FILE = ROOT / "seed" / "01 防城港三期安全管理数据总台账.xlsx"
TRAINING_FILE = ROOT / "seed" / "2026年7月安全培训安排表.xlsx"
TRAINING_MATERIALS_FILE = DATA_DIR / "training_materials.json"
TRAINING_OVERRIDES_FILE = DATA_DIR / "training_overrides.json"

bp = Blueprint("admin", __name__)


@bp.get("/admin")
def admin_page():
    return send_from_directory(ROOT / "public" / "admin", "index.html")


def _file_info(path):
    if not path.exists():
        return {"exists": False, "path": str(path)}
    stat = path.stat()
    return {
        "exists": True,
        "name": path.name,
        "path": str(path),
        "size": stat.st_size,
        "size_mb": round(stat.st_size / 1024 / 1024, 2),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
    }


def _db():
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@bp.get("/api/admin/summary")
def admin_summary():
    result = {}

    # --- hazard DB ---
    with _db() as conn:
        bounds = conn.execute("SELECT MIN(check_date), MAX(check_date), COUNT(*) FROM hazards").fetchone()
        unit_rows = conn.execute(
            "SELECT check_unit, COUNT(*) as cnt FROM hazards GROUP BY check_unit ORDER BY cnt DESC"
        ).fetchall()
        level_rows = conn.execute(
            "SELECT hazard_level, COUNT(*) as cnt FROM hazards WHERE hazard_level != '' GROUP BY hazard_level ORDER BY cnt DESC"
        ).fetchall()
        people_count = conn.execute("SELECT COUNT(*) FROM people WHERE active=1").fetchone()[0]
        people_cats = conn.execute(
            "SELECT category, COUNT(*) as cnt FROM people WHERE active=1 GROUP BY category ORDER BY cnt DESC"
        ).fetchall()
        import_count = conn.execute("SELECT COUNT(*) FROM imports").fetchone()[0]

    result["hazards"] = {
        "total": bounds[2],
        "min_date": bounds[0],
        "max_date": bounds[1],
        "by_unit": [{"unit": r[0], "count": r[1]} for r in unit_rows],
        "by_level": [{"level": r[0], "count": r[1]} for r in level_rows],
    }

    # --- alert data ---
    alert_info = {"source": None}
    if ALERT_DATA_FILE.exists():
        alert_info["source"] = _file_info(ALERT_DATA_FILE)
        alert_info["label"] = "已上传总台账"
    elif ALERT_SEED_FILE.exists():
        alert_info["source"] = _file_info(ALERT_SEED_FILE)
        alert_info["label"] = "种子文件（未上传）"
    result["alert"] = alert_info

    # --- training ---
    result["training"] = {
        "schedule": _file_info(TRAINING_FILE),
        "materials": _file_info(TRAINING_MATERIALS_FILE) if TRAINING_MATERIALS_FILE.exists() else {"exists": False},
        "overrides_count": 0,
    }
    if TRAINING_OVERRIDES_FILE.exists():
        try:
            import json
            overrides = json.loads(TRAINING_OVERRIDES_FILE.read_text(encoding="utf-8"))
            result["training"]["overrides_count"] = len(overrides)
        except Exception:
            pass

    # --- people ---
    result["people"] = {
        "total_active": people_count,
        "by_category": [{"category": r[0], "count": r[1]} for r in people_cats],
    }

    # --- uploads ---
    upload_files = []
    if UPLOAD_DIR.exists():
        for f in sorted(UPLOAD_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.suffix.lower() == ".xlsx":
                upload_files.append(_file_info(f))
    result["uploads"] = {"count": len(upload_files), "files": upload_files[:20]}

    # --- imports history ---
    result["import_count"] = import_count

    return jsonify(result)


@bp.get("/api/admin/imports")
def admin_imports():
    with _db() as conn:
        rows = conn.execute("SELECT * FROM imports ORDER BY id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@bp.get("/api/admin/download")
def admin_download():
    filename = request.args.get("file", "").strip()
    if not filename:
        abort(400)
    target = UPLOAD_DIR / filename
    if not target.exists() or not target.is_file():
        abort(404)
    return send_file(target, as_attachment=True, download_name=filename)
