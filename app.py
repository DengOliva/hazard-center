import json
import math
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "hazards.db"
UPLOAD_DIR = DATA_DIR / "uploads"
SEED_DIR = ROOT / "seed"
TRAINING_SCHEDULE_FILE = SEED_DIR / "2026年7月安全培训安排表.xlsx"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="public", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

REQUIRED_HEADERS = {"隐患单号", "检查人姓名", "检查日期", "检查单位"}
DATASET_TYPES = [
    {
        "id": "hazard_entry",
        "label": "隐患录入统计",
        "filenamePattern": r"^安全隐患信息表_[0-9]{6,20}(?:\s*\([0-9]+\))?\.xlsx$",
        "filenameExample": "安全隐患信息表_20260702141544.xlsx",
        "description": "更新隐患列表、人员录入统计及检查单位对比",
    },
]
DATE_HEADERS = {"检查日期", "整改期限", "实际整改日期", "实际验证日期", "关闭流程日期"}
DEFAULT_DEPARTMENTS = [
    "经理部", "安监部", "物资部", "技术部", "工程部", "质控部", "机械设备管理部",
    "核岛一队", "搅拌站", "水电队", "综合车间", "金属试验室", "钢结构队", "机械队", "测量队",
]
LEADER_DEPARTMENTS = {
    "经理部", "物资部", "技术部", "工程部", "质控部", "机械设备管理部",
    "核岛一队", "搅拌站", "水电队", "综合车间", "金属试验室", "钢结构队", "机械队", "测量队",
}
ROLE_RULES_VERSION = "2026-07-02-v1"
ROLE_STANDARDS = {
    "安全员": (10, "day"),
    "领导": (5, "week"),
    "班组长": (2, "day"),
    "驻场代表": (3, "week"),
}


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS hazards (
            hazard_no TEXT PRIMARY KEY,
            check_date TEXT NOT NULL,
            checker_raw TEXT,
            checker_name TEXT,
            check_unit TEXT,
            check_department TEXT,
            project_name TEXT,
            hazard_level TEXT,
            hazard_category TEXT,
            description TEXT,
            area TEXT,
            status TEXT,
            responsible_unit TEXT,
            responsible_department TEXT,
            responsible_team TEXT,
            raw_json TEXT NOT NULL,
            imported_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hazards_date ON hazards(check_date);
        CREATE INDEX IF NOT EXISTS idx_hazards_checker ON hazards(checker_name);
        CREATE INDEX IF NOT EXISTS idx_hazards_unit ON hazards(check_unit);
        CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            department TEXT NOT NULL DEFAULT '',
            target_count REAL NOT NULL DEFAULT 0,
            target_period TEXT NOT NULL DEFAULT 'week',
            active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            min_date TEXT,
            max_date TEXT
        );
        """)
        defaults = {"internal_unit": "中建二局", "ratio_target": "5"}
        for key, value in defaults.items():
            conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)", (key, value))


def clean_name(value):
    text = str(value or "").strip()
    return re.sub(r"^\[[^\]]+\]", "", text).strip()


def detect_dataset_type(filename):
    name = Path(str(filename or "")).name
    for dataset in DATASET_TYPES:
        if re.fullmatch(dataset["filenamePattern"], name, flags=re.IGNORECASE):
            return dataset
    return None


def parse_training_date(value):
    text = str(value or "").strip()
    match = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", text)
    if not match:
        return "", ""
    year, month, day = map(int, match.groups())
    date_text = date(year, month, day).isoformat()
    weekday_match = re.search(r"（([^）]+)）", text)
    return date_text, weekday_match.group(1) if weekday_match else ""


def split_training_items(value):
    text = str(value or "").strip()
    if not text:
        return []
    parts = []
    for line in re.split(r"[\n\r]+", text):
        for item in re.split(r"[、，,]", str(line).strip()):
            item = item.strip()
            if item:
                parts.append(item)
    return parts


def read_training_schedule():
    if not TRAINING_SCHEDULE_FILE.exists():
        return []
    workbook = load_workbook(TRAINING_SCHEDULE_FILE, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    events = []
    for row in sheet.iter_rows(min_row=3, values_only=True):
        schedule_date, weekday = parse_training_date(row[0] if len(row) > 0 else "")
        if not schedule_date:
            continue
        morning_text = row[1] if len(row) > 1 else None
        morning_lines = [line.strip() for line in re.split(r"[\n\r]+", str(morning_text or "").strip()) if line.strip()]
        if morning_lines:
            events.append({
                "date": schedule_date,
                "weekday": weekday,
                "time": "08:00-10:00",
                "period": "上午第一场",
                "title": morning_lines[0],
                "items": split_training_items(morning_lines[0]),
            })
        if len(morning_lines) > 1:
            second_text = "\n".join(morning_lines[1:])
            events.append({
                "date": schedule_date,
                "weekday": weekday,
                "time": "10:00-11:30",
                "period": "上午第二场",
                "title": second_text,
                "items": split_training_items(second_text),
            })
        for col_index, title in ((3, "下午第一组"), (4, "下午第二组")):
            if len(row) > col_index and row[col_index]:
                text = str(row[col_index]).strip()
                events.append({
                    "date": schedule_date,
                    "weekday": weekday,
                    "time": "14:00-17:30",
                    "period": title,
                    "title": text,
                    "items": split_training_items(text),
                })
        if len(row) > 5 and row[5]:
            text = str(row[5]).strip()
            events.append({
                "date": schedule_date,
                "weekday": weekday,
                "time": "晚上",
                "period": "晚上",
                "title": text,
                "items": split_training_items(text),
            })
    return events


def week_range_for(value):
    current = iso_date(value) if value else date.today().isoformat()
    current_date = datetime.strptime(current, "%Y-%m-%d").date()
    start = current_date - timedelta(days=current_date.weekday())
    end = start + timedelta(days=6)
    return start.isoformat(), end.isoformat()


def iso_date(value):
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text[:19], fmt).date().isoformat()
        except ValueError:
            pass
    return text[:10]


def json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    return value


def find_data_sheet(workbook):
    for sheet in workbook.worksheets:
        header = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
        if REQUIRED_HEADERS.issubset(set(header)):
            return sheet, header
    raise ValueError("未找到完整表头，需要包含：隐患单号、检查人姓名、检查日期、检查单位")


def import_hazards(path, original_name):
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet, headers = find_data_sheet(workbook)
    now = datetime.now().isoformat(timespec="seconds")
    records = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        item = {str(headers[i]).strip(): json_value(value) for i, value in enumerate(row) if i < len(headers) and headers[i]}
        hazard_no = str(item.get("隐患单号") or "").strip()
        if not hazard_no:
            continue
        check_date = iso_date(item.get("检查日期"))
        records.append((
            hazard_no, check_date, str(item.get("检查人姓名") or ""), clean_name(item.get("检查人姓名")),
            str(item.get("检查单位") or "").strip(), str(item.get("检查部门") or "").strip(),
            str(item.get("项目名称") or "").strip(), str(item.get("隐患级别") or "").strip(),
            str(item.get("隐患分类") or "").strip(), str(item.get("隐患描述") or "").strip(),
            str(item.get("区域") or "").strip(), str(item.get("状态") or item.get("流程状态") or "").strip(),
            str(item.get("责任单位") or "").strip(), str(item.get("责任部门") or "").strip(),
            str(item.get("责任班组") or "").strip(), json.dumps(item, ensure_ascii=False), now,
        ))
    if not records:
        raise ValueError("表格中没有可导入的隐患记录")
    with db() as conn:
        conn.execute("DELETE FROM hazards")
        conn.executemany("""INSERT INTO hazards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", records)
        dates = [r[1] for r in records if r[1]]
        conn.execute("INSERT INTO imports(filename,imported_at,row_count,min_date,max_date) VALUES (?,?,?,?,?)",
                     (original_name, now, len(records), min(dates) if dates else None, max(dates) if dates else None))
    return {"count": len(records), "minDate": min(dates), "maxDate": max(dates), "filename": original_name,
            "datasetType": "hazard_entry", "datasetLabel": "隐患录入统计"}


def seed_people():
    legacy = SEED_DIR / "隐患统计查询工具1.02.xlsx"
    if not legacy.exists():
        return
    with db() as conn:
        if conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]:
            return
    workbook = load_workbook(legacy, read_only=True, data_only=True)
    sheet = workbook["数据查询界面"]
    found = {}
    for row in sheet.iter_rows(min_row=8, max_row=196, values_only=True):
        for category, name, target in ((row[1], row[2], row[3]), (row[8], row[9], row[10])):
            if not name or not category or str(category).startswith("统计"):
                continue
            name = clean_name(name)
            category = str(category).strip()
            if not name or name in found:
                continue
            period = "day" if category == "安监部" else "week"
            default_target = 10 if category == "安监部" else (7 if "班组长" in category else 5)
            numeric_target = float(target) if isinstance(target, (int, float)) else default_target
            found[name] = (name, category, category if category in DEFAULT_DEPARTMENTS else "", numeric_target, period)
    with db() as conn:
        conn.executemany("INSERT OR IGNORE INTO people(name,category,department,target_count,target_period) VALUES (?,?,?,?,?)", found.values())


def apply_role_rules():
    with db() as conn:
        current = conn.execute("SELECT value FROM settings WHERE key='role_rules_version'").fetchone()
        if current and current[0] == ROLE_RULES_VERSION:
            return
        people = conn.execute("SELECT id,name,category,department FROM people").fetchall()
        for person in people:
            legacy_category = str(person["category"] or "").strip()
            department = str(person["department"] or "").strip()
            role = None
            if person["name"] == "赵强强":
                role = "领导"
            elif legacy_category in ("安全员", "安监部"):
                role = "安全员"
                department = department or "安监部"
            elif "班组长" in legacy_category:
                role = "班组长"
            elif legacy_category == "驻场代表":
                role = "驻场代表"
            elif legacy_category == "领导" or legacy_category in LEADER_DEPARTMENTS:
                role = "领导"
                department = department or legacy_category
            if role:
                target, period = ROLE_STANDARDS[role]
                conn.execute("UPDATE people SET category=?,department=?,target_count=?,target_period=?,active=1 WHERE id=?",
                             (role, department, target, period, person["id"]))
            else:
                conn.execute("UPDATE people SET active=0 WHERE id=?", (person["id"],))
        conn.execute("INSERT INTO settings(key,value) VALUES('role_rules_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                     (ROLE_RULES_VERSION,))


def seed_data():
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM hazards").fetchone()[0]
    if count:
        return
    candidates = sorted(SEED_DIR.glob("安全隐患信息表*.xlsx"))
    if candidates:
        import_hazards(candidates[-1], candidates[-1].name)


def range_args():
    end = request.args.get("end") or date.today().isoformat()
    start = request.args.get("start") or (date.fromisoformat(end) - timedelta(days=6)).isoformat()
    return start, end


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/training")
def training_page():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/health")
def health():
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM hazards").fetchone()[0]
    return jsonify(ok=True, records=count)


@app.get("/api/meta")
def meta():
    with db() as conn:
        categories = [r[0] for r in conn.execute("SELECT DISTINCT category FROM people WHERE active=1 ORDER BY category")]
        departments = [r[0] for r in conn.execute("SELECT DISTINCT department FROM people WHERE department<>'' ORDER BY department")]
        last_import = conn.execute("SELECT * FROM imports ORDER BY id DESC LIMIT 1").fetchone()
        bounds = conn.execute("SELECT MIN(check_date),MAX(check_date),COUNT(*) FROM hazards").fetchone()
    return jsonify(categories=categories, departments=departments, defaultDepartments=DEFAULT_DEPARTMENTS,
                   datasetTypes=[{k: v for k, v in item.items() if k != "filenamePattern"} for item in DATASET_TYPES],
                   lastImport=dict(last_import) if last_import else None,
                   bounds={"min": bounds[0], "max": bounds[1], "count": bounds[2]})


@app.post("/api/import")
def upload():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(error="请选择 Excel 文件"), 400
    if not file.filename.lower().endswith(".xlsx"):
        return jsonify(error="目前只支持 .xlsx 文件"), 400
    dataset = detect_dataset_type(file.filename)
    if not dataset:
        examples = "、".join(item["filenameExample"] for item in DATASET_TYPES)
        return jsonify(error=f"无法根据文件名识别数据类型。当前支持：{examples}", code="unknown_dataset"), 400
    target = UPLOAD_DIR / f"{datetime.now():%Y%m%d%H%M%S%f}_{dataset['id']}.xlsx"
    file.save(target)
    try:
        if dataset["id"] == "hazard_entry":
            return jsonify(import_hazards(target, file.filename))
        return jsonify(error=f"数据类型“{dataset['label']}”尚未配置导入器"), 501
    except Exception as exc:
        target.unlink(missing_ok=True)
        return jsonify(error=str(exc)), 400


@app.get("/api/hazards")
def hazards():
    start, end = range_args()
    page = max(1, int(request.args.get("page", 1)))
    size = min(200, max(10, int(request.args.get("size", 50))))
    search = request.args.get("search", "").strip()
    unit = request.args.get("unit", "").strip()
    where = ["check_date BETWEEN ? AND ?"]
    params = [start, end]
    if search:
        where.append("(checker_name LIKE ? OR description LIKE ? OR hazard_no LIKE ? OR area LIKE ?)")
        params += [f"%{search}%"] * 4
    if unit:
        where.append("check_unit=?")
        params.append(unit)
    clause = " AND ".join(where)
    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(f"""SELECT hazard_no,check_date,checker_name,check_unit,check_department,hazard_level,
                             hazard_category,description,area,status,responsible_department,responsible_team
                             FROM hazards WHERE {clause} ORDER BY check_date DESC,hazard_no DESC LIMIT ? OFFSET ?""",
                            params + [size, (page - 1) * size]).fetchall()
        units = [r[0] for r in conn.execute("SELECT DISTINCT check_unit FROM hazards WHERE check_unit<>'' ORDER BY check_unit")]
    return jsonify(items=[dict(r) for r in rows], total=total, page=page, size=size, units=units)


@app.get("/api/people")
def people():
    with db() as conn:
        rows = conn.execute("SELECT * FROM people ORDER BY category,department,name").fetchall()
    return jsonify(items=[dict(r) for r in rows])


@app.post("/api/people")
def save_person():
    item = request.get_json(force=True)
    name = clean_name(item.get("name"))
    if not name:
        return jsonify(error="姓名不能为空"), 400
    values = (name, str(item.get("category") or "其他"), str(item.get("department") or ""),
              max(0, float(item.get("target_count") or 0)),
              "day" if item.get("target_period") == "day" else "week", 1 if item.get("active", True) else 0)
    with db() as conn:
        if item.get("id"):
            conn.execute("UPDATE people SET name=?,category=?,department=?,target_count=?,target_period=?,active=? WHERE id=?",
                         values + (int(item["id"]),))
            person_id = int(item["id"])
        else:
            cursor = conn.execute("INSERT INTO people(name,category,department,target_count,target_period,active) VALUES (?,?,?,?,?,?)", values)
            person_id = cursor.lastrowid
    return jsonify(ok=True, id=person_id)


@app.delete("/api/people/<int:person_id>")
def delete_person(person_id):
    with db() as conn:
        conn.execute("DELETE FROM people WHERE id=?", (person_id,))
    return jsonify(ok=True)


@app.get("/api/statistics")
def statistics():
    start, end = range_args()
    category = request.args.get("category", "").strip()
    department = request.args.get("department", "").strip()
    start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
    days = (end_date - start_date).days + 1
    with db() as conn:
        settings = {r[0]: r[1] for r in conn.execute("SELECT key,value FROM settings")}
        internal = settings.get("internal_unit", "中建二局")
        ratio_target = float(settings.get("ratio_target", 5))
        internal_count = conn.execute("SELECT COUNT(*) FROM hazards WHERE check_date BETWEEN ? AND ? AND check_unit=?", (start, end, internal)).fetchone()[0]
        external_count = conn.execute("SELECT COUNT(*) FROM hazards WHERE check_date BETWEEN ? AND ? AND (check_unit<>? OR check_unit IS NULL OR check_unit='')", (start, end, internal)).fetchone()[0]
        where = ["active=1"]
        params = []
        if category:
            where.append("category=?"); params.append(category)
        if department:
            where.append("department=?"); params.append(department)
        roster = conn.execute(f"SELECT * FROM people WHERE {' AND '.join(where)} ORDER BY category,department,name", params).fetchall()
        counts = {r[0]: r[1] for r in conn.execute("SELECT checker_name,COUNT(*) FROM hazards WHERE check_date BETWEEN ? AND ? GROUP BY checker_name", (start, end))}
        b_counts = {r[0]: r[1] for r in conn.execute("SELECT checker_name,COUNT(*) FROM hazards WHERE check_date BETWEEN ? AND ? AND hazard_level='B' GROUP BY checker_name", (start, end))}
    result = []
    for person in roster:
        multiplier = days if person["target_period"] == "day" else math.ceil(days / 7)
        target = person["target_count"] * multiplier
        count = counts.get(person["name"], 0)
        result.append({**dict(person), "count": count, "bCount": b_counts.get(person["name"], 0),
                       "periodTarget": target, "met": count >= target})
    ratio = None if external_count == 0 else round(internal_count / external_count, 2)
    return jsonify(start=start, end=end, days=days, people=result,
                   comparison={"internal": internal_count, "external": external_count, "ratio": ratio,
                               "target": ratio_target, "met": external_count == 0 or ratio >= ratio_target,
                               "internalUnit": internal})


@app.get("/api/training/schedule")
def training_schedule():
    events = read_training_schedule()
    bounds = {
        "min": min((event["date"] for event in events), default=""),
        "max": max((event["date"] for event in events), default=""),
        "count": len(events),
        "source": TRAINING_SCHEDULE_FILE.name if TRAINING_SCHEDULE_FILE.exists() else "",
    }
    start = request.args.get("start") or ""
    end = request.args.get("end") or ""
    if not start or not end:
        today = date.today().isoformat()
        if bounds["min"] and not (bounds["min"] <= today <= bounds["max"]):
            today = bounds["min"]
        start, end = week_range_for(today)
    keyword = (request.args.get("keyword") or "").strip()
    filtered = []
    for event in events:
        if start and event["date"] < start:
            continue
        if end and event["date"] > end:
            continue
        haystack = " ".join([event["date"], event["weekday"], event["time"], event["period"], event["title"], " ".join(event["items"])])
        if keyword and keyword not in haystack:
            continue
        filtered.append(event)
    return jsonify({"items": filtered, "bounds": bounds, "start": start, "end": end})


init_db()
seed_people()
apply_role_rules()
seed_data()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("APP_PORT", "8010")), debug=os.environ.get("FLASK_DEBUG") == "1")
