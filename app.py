import json
import math
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from openpyxl import load_workbook

from data_admin import bp as admin_bp
from meeting import bp as meeting_bp

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "hazards.db"
UPLOAD_DIR = DATA_DIR / "uploads"
SEED_DIR = ROOT / "seed"
TRAINING_SCHEDULE_FILE = SEED_DIR / "2026年7月安全培训安排表.xlsx"
TRAINING_OVERRIDES_FILE = DATA_DIR / "training_overrides.json"
TRAINING_MATERIALS_FILE = DATA_DIR / "training_materials.json"
TRAINING_EDIT_PASSWORD = os.environ.get("TRAINING_EDIT_PASSWORD", "@q")
MATERIAL_CATEGORIES = ["入场培训", "复训", "签到单", "三级安全教育卡", "通知目录", "其他"]
ALERT_SEED_FILE = SEED_DIR / "01 防城港三期安全管理数据总台账.xlsx"
ALERT_DATA_FILE = DATA_DIR / "alert_台账.xlsx"

# Detail sheet column config: (sheet_name, category, type_name, date_col, dept_col, sub_col, problem_type_col)
# dept_col=0 / sub_col=0 / problem_type_col=0 means no such column in that sheet
DETAIL_SHEET_CONFIG = [
    ("工程公司挂牌督办单", "external", "挂牌督办", 2, 8, 11, 0),
    ("红黄牌", "external", "红黄牌", 3, 5, 12, 7),
    ("工程公司处理通报", "external", "处理通报", 4, 8, 10, 0),
    ("工程公司通报批评", "external", "处理通报", 5, 0, 11, 7),
    ("工程公司整改单", "external", "整改单", 6, 9, 12, 8),
    ("工程公司停工令", "external", "停工令", 5, 10, 13, 0),
    ("监理业主整改通知单", "external", "监理通知单", 5, 7, 10, 0),
    ("工程公司违章培训通知单", "external", "违章培训通知单", 7, 12, 3, 0),
    ("项目内部处理通报", "internal", "处理通报", 3, 7, 8, 6),
    ("项目整改通知单", "internal", "整改单", 3, 7, 8, 5),
    ("项目停工令", "internal", "停工令", 2, 6, 10, 0),
    ("项目违章培训通知单", "internal", "违章培训通知单", 7, 10, 4, 9),
]

NON_SUB_NAMES = {"分包", "责任分包", "项目总承包部", "总承包", "总承包部",
                  "综合车间", "钢结构队", "核岛一队", "水电队", "机械队", "搅拌站",
                  "驻场人员", "综合队", "测量队", "金属试验室", "机械设备管理部"}


def clean_sub_name(raw):
    """Normalize subcontractor name: remove | prefix, strip （...）suffix, skip invalid."""
    if not raw:
        return ""
    name = raw.strip()
    if name in NON_SUB_NAMES:
        return ""
    # Cells with many 、 are summary lists, not single subs (3+ names = 2+ separators)
    if name.count("、") >= 2:
        return ""
    # Take the part after the last |
    if "|" in name:
        name = name.rsplit("|", 1)[-1].strip()
    # Remove （...） / (...) suffix
    name = re.sub(r"[（(][^）)]*[）)]", "", name).strip()
    if not name or name in ("/", "None", "#N/A", "") or name in NON_SUB_NAMES:
        return ""
    return name


def clean_problem_type(raw):
    """Normalize problem type: remove leading numbers/tabs, split by comma, skip empty."""
    if not raw:
        return []
    text = str(raw).strip()
    # Remove leading digits, tabs, and separators like "1\t" or "12 "
    text = re.sub(r"^[\d\s\t]+", "", text)
    if not text or text in ("/", "None", "#N/A", "", "A", "B", "C", "A级", "B级", "C级"):
        return []
    # Split by comma or Chinese comma
    parts = re.split(r"[，,]", text)
    result = []
    for p in parts:
        p = p.strip()
        # Remove leading digits again for each part
        p = re.sub(r"^[\d\s\t]+", "", p).strip()
        if p and p not in ("/", "None", "#N/A", "", "A", "B", "C"):
            result.append(p)
    return result


# Alert dashboard data cache
_alert_data = None
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


def training_event(event_id, schedule_date, weekday, time_text, period, title, items=None, order=0):
    return {
        "id": event_id,
        "date": schedule_date,
        "weekday": weekday,
        "time": time_text,
        "period": period,
        "title": title,
        "items": items if items is not None else split_training_items(title),
        "order": order,
    }


def load_training_overrides():
    if not TRAINING_OVERRIDES_FILE.exists():
        return {}
    try:
        return json.loads(TRAINING_OVERRIDES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_training_overrides(overrides):
    TRAINING_OVERRIDES_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRAINING_OVERRIDES_FILE.write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")


def load_training_materials():
    if not TRAINING_MATERIALS_FILE.exists():
        return []
    try:
        return json.loads(TRAINING_MATERIALS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_training_materials(materials):
    TRAINING_MATERIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRAINING_MATERIALS_FILE.write_text(json.dumps(materials, ensure_ascii=False, indent=2), encoding="utf-8")


def apply_training_overrides(events):
    overrides = load_training_overrides()
    for event in events:
        override = overrides.get(event["id"])
        if not override:
            continue
        for key in ("time", "period", "title", "items"):
            if key in override:
                event[key] = override[key]
        event["edited"] = True
    return events


def add_annual_retraining(events):
    plans = {
        "2026-07-04": "7月年度复训",
        "2026-07-05": "7月年度复训",
        "2026-07-24": "8月年度复训",
        "2026-07-25": "8月年度复训",
    }
    weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    for schedule_date, label in plans.items():
        current = date.fromisoformat(schedule_date)
        weekday = weekday_names[current.weekday()]
        events.append(training_event(
            f"annual:{schedule_date}:signin", schedule_date, weekday, "08:00-10:00",
            "年度复训签到", f"{label}公司级签到", ["年度复训", "公司级签到"], 80,
        ))
        events.append(training_event(
            f"annual:{schedule_date}:exam", schedule_date, weekday, "10:00-11:30",
            "年度复训考试", f"11:00 {label}公司级考试", ["年度复训", "公司级考试"], 81,
        ))
        events.append(training_event(
            f"annual:{schedule_date}:night", schedule_date, weekday, "19:00-20:30",
            "晚上", label, [label], 90,
        ))
    return events


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
        day_index = len([event for event in events if event["date"] == schedule_date])
        morning_text = row[1] if len(row) > 1 else None
        morning_lines = [line.strip() for line in re.split(r"[\n\r]+", str(morning_text or "").strip()) if line.strip()]
        if morning_lines:
            events.append(training_event(
                f"base:{schedule_date}:morning1", schedule_date, weekday, "08:00-10:00",
                "上午第一场", morning_lines[0], order=10 + day_index,
            ))
        if len(morning_lines) > 1:
            second_text = "\n".join(morning_lines[1:])
            events.append(training_event(
                f"base:{schedule_date}:morning2", schedule_date, weekday, "10:00-11:30",
                "上午第二场", second_text, order=20 + day_index,
            ))
        afternoon_parts = []
        for col_index in (3, 4):
            if len(row) > col_index and row[col_index]:
                afternoon_parts.append(str(row[col_index]).strip())
        if afternoon_parts:
            text = "、".join(afternoon_parts)
            events.append(training_event(
                f"base:{schedule_date}:afternoon", schedule_date, weekday, "14:00-17:30",
                "下午", text, order=30 + day_index,
            ))
        if len(row) > 5 and row[5]:
            text = str(row[5]).strip()
            events.append(training_event(
                f"base:{schedule_date}:night", schedule_date, weekday, "19:00-20:30",
                "晚上", text, order=90 + day_index,
            ))
    add_annual_retraining(events)
    apply_training_overrides(events)
    return sorted(events, key=lambda item: (item["date"], item.get("order", 0), item["time"], item["period"]))


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
            str(item.get("区域") or "").strip(), str(item.get("流程状态") or item.get("状态") or "").strip(),
            str(item.get("责任单位") or "").strip(), str(item.get("责任部门") or "").strip(),
            str(item.get("责任班组") or "").strip(), json.dumps(item, ensure_ascii=False), now,
        ))
    if not records:
        raise ValueError("表格中没有可导入的隐患记录")
    with db() as conn:
        conn.executemany("""INSERT OR REPLACE INTO hazards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", records)
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


def load_alert_data():
    """Parse the 总台账 Excel. Tries DATA_DIR first, falls back to SEED_DIR."""
    global _alert_data
    if _alert_data is not None:
        return _alert_data

    src = None
    if ALERT_DATA_FILE.exists():
        src = ALERT_DATA_FILE
    elif ALERT_SEED_FILE.exists():
        src = ALERT_SEED_FILE

    if not src:
        _alert_data = {}
        return _alert_data

    wb = load_workbook(src, data_only=True)

    def cell(ws, r, c):
        v = ws.cell(row=r, column=c).value
        return v if v is not None else 0

    # --- Parse 总台账及统计分析 ---
    ws = wb["总台账及统计分析"]
    MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]

    external_types = [
        ("挂牌督办", 4), ("管理约谈", 5), ("红黄牌", 6), ("处理通报", 7),
        ("停工令", 9), ("整改单", 11), ("违章培训通知单", 13), ("监理通知单", 16),
    ]
    internal_types = [
        ("停工令", 10), ("处理通报", 8), ("整改单", 12), ("违章培训通知单", 14),
    ]

    def parse_monthly(row):
        monthly = []
        for c in range(2, 14):  # cols B-M
            v = cell(ws, row, c)
            monthly.append(int(v) if v else 0)
        return monthly

    external = []
    for name, row in external_types:
        monthly = parse_monthly(row)
        external.append({"name": name, "monthly": monthly, "total": sum(monthly)})

    internal = []
    for name, row in internal_types:
        monthly = parse_monthly(row)
        internal.append({"name": name, "monthly": monthly, "total": sum(monthly)})

    # Department data (rows 5-14, columns Q-AG)
    # Dept col mapping: R/S=整改单(当月/累计), T/U=监理, V/W=项目内部,
    #   X/Y=违章培训(当月/累计), Z/AA=项目内部违章,
    #   AB/AC=处理通报(当月/累计), AD/AE=项目内部通报,
    #   AF=黄牌, AG=挂牌督办
    dept_names = []
    dept_external_rect = []  # 整改单 累计
    dept_external_violation = []  # 违章培训 累计
    dept_external_notice = []  # 处理通报 累计
    dept_yellow = []  # 黄牌
    dept_supervision = []  # 挂牌督办

    for r in range(5, 15):
        name = str(cell(ws, r, 17) or "")  # Q column
        if not name or name == "0":
            continue
        dept_names.append(name)
        dept_external_rect.append(int(cell(ws, r, 19)))  # S=累计
        dept_external_violation.append(int(cell(ws, r, 25)))  # Y=累计
        dept_external_notice.append(int(cell(ws, r, 29)))  # AC=累计
        dept_yellow.append(int(cell(ws, r, 32)))  # AF
        dept_supervision.append(int(cell(ws, r, 33)))  # AG

    departments = {
        "names": dept_names,
        "external": [
            {"label": "整改单", "values": dept_external_rect},
            {"label": "违章培训通知单", "values": dept_external_violation},
            {"label": "处理通报", "values": dept_external_notice},
            {"label": "黄牌", "values": dept_yellow},
            {"label": "挂牌督办", "values": dept_supervision},
        ],
        # Internal dept data: project rectification + project violation + project notice
        # From cols: V=当月, W=累计(整改单), Z=当月, AA=累计(违章), AD=当月, AE=累计(通报)
        "internal": [],
    }
    for r in range(5, 15):
        name = str(cell(ws, r, 17) or "")
        if not name or name == "0":
            continue
        departments["internal"].append({
            "name": name,
            "rectification": int(cell(ws, r, 23)),  # W=累计
            "violation": int(cell(ws, r, 27)),  # AA=累计
            "notice": int(cell(ws, r, 31)),  # AE=累计
        })

    # --- Parse subcontractor data from detail sheets ---
    subcontractors = {}
    detail_sheets = [
        "工程公司挂牌督办单", "红黄牌", "工程公司处理通报", "工程公司通报批评",
        "工程公司整改单", "工程公司停工令", "监理业主整改通知单",
        "项目内部处理通报", "项目整改通知单", "项目停工令",
        "项目违章培训通知单", "工程公司违章培训通知单",
    ]
    for sheet_name in detail_sheets:
        if sheet_name not in wb.sheetnames:
            continue
        dws = wb[sheet_name]
        # Determine column index for subcontractor name (varies by sheet)
        header_row = 1
        sub_col = None
        for c in range(1, dws.max_column + 1):
            h = str(dws.cell(row=1, column=c).value or "")
            if "分包" in h:
                sub_col = c
                break
        if sub_col is None:
            continue
        for r in range(2, dws.max_row + 1):
            name = clean_sub_name(str(dws.cell(row=r, column=sub_col).value or ""))
            if name:
                subcontractors[name] = subcontractors.get(name, 0) + 1

    sub_list = sorted(
        [{"name": k, "count": v} for k, v in subcontractors.items()],
        key=lambda x: -x["count"],
    )

    # --- Parse detail records for monthly filtering & chart data ---
    sub_monthly = {}  # {month: {sub_name: {"external": {type: cnt}, "internal": {type: cnt}}}}
    dept_monthly = {}  # {month: {dept_name: {"external": {type: cnt}, "internal": {type: cnt}}}}
    sub_totals = {}  # {sub_name: {"external": total, "internal": total}}
    dept_totals = {}  # {dept_name: {"external": total, "internal": total}}
    detail_records = []  # [{date, sub_name, dept_name, category, type_name}]

    for sheet_name, category, type_name, date_col, dept_col, sub_col, prob_col in DETAIL_SHEET_CONFIG:
        if sheet_name not in wb.sheetnames:
            continue
        dws = wb[sheet_name]
        for r in range(2, dws.max_row + 1):
            date_val = dws.cell(row=r, column=date_col).value
            if date_val is None:
                continue
            parsed = iso_date(date_val)
            if not parsed:
                continue
            try:
                month = int(parsed[5:7])
                if month < 1 or month > 12:
                    continue
            except (ValueError, IndexError):
                continue

            sub_name = ""
            if sub_col > 0:
                sub_name = clean_sub_name(str(dws.cell(row=r, column=sub_col).value or ""))

            dept_name = ""
            if dept_col > 0:
                dept_name = str(dws.cell(row=r, column=dept_col).value or "").strip()
                if dept_name in ("/", "None", "#N/A", ""):
                    dept_name = ""

            # Parse problem type(s) from the detail sheet
            problem_types = []
            if prob_col > 0:
                pv = dws.cell(row=r, column=prob_col).value
                if pv:
                    problem_types = clean_problem_type(str(pv))

            for pt in problem_types:
                detail_records.append({
                    "date": parsed, "sub_name": sub_name,
                    "dept_name": dept_name, "category": category,
                    "type_name": type_name, "problem_type": pt,
                })
            if not problem_types:
                detail_records.append({
                    "date": parsed, "sub_name": sub_name,
                    "dept_name": dept_name, "category": category,
                    "type_name": type_name, "problem_type": "",
                })

            if sub_name:
                m = sub_monthly.setdefault(month, {})
                s = m.setdefault(sub_name, {"external": {}, "internal": {}})
                s[category][type_name] = s[category].get(type_name, 0) + 1
                st = sub_totals.setdefault(sub_name, {"external": 0, "internal": 0})
                st[category] += 1

            if dept_name:
                m = dept_monthly.setdefault(month, {})
                d = m.setdefault(dept_name, {"external": {}, "internal": {}})
                d[category][type_name] = d[category].get(type_name, 0) + 1
                dt = dept_totals.setdefault(dept_name, {"external": 0, "internal": 0})
                dt[category] += 1

    # --- Parse scores ---
    scores = {"star5_2025": [], "aqhb_2025": [], "star5_2026": [], "aqhb_2026": []}
    if "五星评估、安质环考核得分" in wb.sheetnames:
        sws = wb["五星评估、安质环考核得分"]
        # 2025 data rows 14-16
        for i, m in enumerate(MONTHS):
            v = sws.cell(row=15, column=2 + i).value
            if v is not None:
                scores["star5_2025"].append({"month": m, "score": float(v)})
        for i, m in enumerate(MONTHS):
            v = sws.cell(row=16, column=2 + i).value
            if v is not None:
                scores["aqhb_2025"].append({"month": m, "score": float(v)})
        # 2026 data rows 78-79
        for i, m in enumerate(MONTHS):
            v = sws.cell(row=78, column=2 + i).value
            if v is not None:
                scores["star5_2026"].append({"month": m, "score": float(v)})
        for i, m in enumerate(MONTHS):
            v = sws.cell(row=79, column=2 + i).value
            if v is not None:
                scores["aqhb_2026"].append({"month": m, "score": float(v)})

    wb.close()

    _alert_data = {
        "external": external,
        "internal": internal,
        "departments": departments,
        "subcontractors": sub_list,
        "scores": scores,
        "months": MONTHS,
        "sub_monthly": sub_monthly,
        "dept_monthly": dept_monthly,
        "sub_totals": sub_totals,
        "dept_totals": dept_totals,
        "detail_records": detail_records,
    }
    return _alert_data


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
    return send_from_directory(app.static_folder, "training.html")


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


@app.get("/api/hazards/stats")
def hazard_stats():
    start, end = range_args()
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
        internal_count = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause} AND check_unit=?", params + ["中建二局"]).fetchone()[0]
        external_count = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause} AND check_unit=?", params + ["工程公司"]).fetchone()[0]
        b_hazards = [dict(r) for r in conn.execute(
            f"SELECT description, checker_name, check_date FROM hazards WHERE {clause} AND hazard_level='B' ORDER BY check_date DESC", params)]
        b_internal = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause} AND hazard_level='B' AND check_unit=?", params + ["中建二局"]).fetchone()[0]
        b_external = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause} AND hazard_level='B' AND check_unit=?", params + ["工程公司"]).fetchone()[0]
        rectification_count = conn.execute(f"SELECT COUNT(*) FROM hazards WHERE {clause} AND status=?", params + ["进行中"]).fetchone()[0]
        rectification_rate = round((1 - rectification_count / total) * 100, 1) if total > 0 else 0
    return jsonify(total=total, internal=internal_count, external=external_count, bHazards=b_hazards, bInternal=b_internal, bExternal=b_external, rectificationCount=rectification_count, rectificationRate=rectification_rate)


@app.get("/api/hazards/category-stats")
def hazard_category_stats():
    start, end = range_args()
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
        cats = conn.execute(
            f"SELECT hazard_category, check_unit, COUNT(*) as cnt FROM hazards WHERE {clause} AND hazard_category IS NOT NULL AND hazard_category != '' GROUP BY hazard_category, check_unit ORDER BY cnt DESC",
            params).fetchall()
        levels = conn.execute(
            f"SELECT hazard_level, COUNT(*) as cnt FROM hazards WHERE {clause} AND hazard_level IS NOT NULL AND hazard_level != '' GROUP BY hazard_level ORDER BY cnt DESC",
            params).fetchall()
    cat_map = {}
    for row in cats:
        cat = row[0]
        unit = row[1]
        cnt = row[2]
        if cat not in cat_map:
            cat_map[cat] = {"category": cat, "total": 0, "internal": 0, "external": 0}
        cat_map[cat]["total"] += cnt
        if unit == "中建二局":
            cat_map[cat]["internal"] += cnt
        else:
            cat_map[cat]["external"] += cnt
    categories = sorted(cat_map.values(), key=lambda x: x["total"], reverse=True)
    levels_result = [{"level": row[0], "count": row[1]} for row in levels]
    return jsonify(categories=categories, levels=levels_result)


@app.get("/api/hazards/category-descriptions")
def hazard_category_descriptions():
    start, end = range_args()
    category = request.args.get("category", "").strip()
    if not category:
        return jsonify(descriptions=[])
    search = request.args.get("search", "").strip()
    unit = request.args.get("unit", "").strip()
    where = ["check_date BETWEEN ? AND ?", "hazard_category=?"]
    params = [start, end, category]
    if search:
        where.append("(checker_name LIKE ? OR description LIKE ? OR hazard_no LIKE ? OR area LIKE ?)")
        params += [f"%{search}%"] * 4
    if unit:
        where.append("check_unit=?")
        params.append(unit)
    clause = " AND ".join(where)
    with db() as conn:
        rows = conn.execute(
            f"SELECT description, check_date, check_unit, hazard_level FROM hazards WHERE {clause} ORDER BY check_date DESC LIMIT 100",
            params).fetchall()
    return jsonify(descriptions=[dict(r) for r in rows])


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
        external_count = conn.execute("SELECT COUNT(*) FROM hazards WHERE check_date BETWEEN ? AND ? AND check_unit=?", (start, end, "工程公司")).fetchone()[0]
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


@app.post("/api/training/save")
def training_save():
    body = request.get_json(force=True)
    pwd = str(body.get("password") or "")
    if pwd != TRAINING_EDIT_PASSWORD:
        return jsonify(error="密码错误"), 403
    event_id = str(body.get("id") or "").strip()
    if not event_id:
        return jsonify(error="缺少事件 ID"), 400
    overrides = load_training_overrides()
    entry = overrides.get(event_id, {})
    for key in ("time", "period", "title", "items"):
        if key in body and body[key] is not None:
            entry[key] = body[key]
    overrides[event_id] = entry
    save_training_overrides(overrides)
    return jsonify(ok=True, id=event_id)


@app.post("/api/training/reset")
def training_reset():
    body = request.get_json(force=True)
    pwd = str(body.get("password") or "")
    if pwd != TRAINING_EDIT_PASSWORD:
        return jsonify(error="密码错误"), 403
    event_id = str(body.get("id") or "").strip()
    overrides = load_training_overrides()
    if event_id:
        overrides.pop(event_id, None)
    else:
        overrides.clear()
    save_training_overrides(overrides)
    return jsonify(ok=True)


@app.post("/api/training/verify")
def training_verify():
    body = request.get_json(force=True)
    if str(body.get("password") or "") == TRAINING_EDIT_PASSWORD:
        return jsonify(ok=True)
    return jsonify(error="密码错误"), 403


@app.get("/api/training/materials")
def training_materials():
    materials = load_training_materials()
    category = request.args.get("category", "").strip()
    if category:
        materials = [m for m in materials if m.get("category") == category]
    materials.sort(key=lambda m: (MATERIAL_CATEGORIES.index(m.get("category", "其他")) if m.get("category") in MATERIAL_CATEGORIES else 99, m.get("sort", 0)))
    return jsonify({"items": materials, "categories": MATERIAL_CATEGORIES})


@app.post("/api/training/materials/save")
def training_materials_save():
    body = request.get_json(force=True)
    if str(body.get("password") or "") != TRAINING_EDIT_PASSWORD:
        return jsonify(error="密码错误"), 403
    materials = load_training_materials()
    item_id = str(body.get("id") or "").strip()
    now = datetime.now().isoformat(timespec="seconds")
    if item_id:
        found = False
        for m in materials:
            if m["id"] == item_id:
                for key in ("category", "title", "content", "sort"):
                    if key in body and body[key] is not None:
                        m[key] = body[key]
                m["updated_at"] = now
                found = True
                break
        if not found:
            return jsonify(error="未找到该资料"), 404
    else:
        materials.append({
            "id": str(uuid.uuid4())[:8],
            "category": body.get("category", "其他"),
            "title": body.get("title", ""),
            "content": body.get("content", ""),
            "sort": int(body.get("sort", 0)),
            "updated_at": now,
        })
    save_training_materials(materials)
    return jsonify(ok=True)


@app.post("/api/training/materials/delete")
def training_materials_delete():
    body = request.get_json(force=True)
    if str(body.get("password") or "") != TRAINING_EDIT_PASSWORD:
        return jsonify(error="密码错误"), 403
    item_id = str(body.get("id") or "").strip()
    materials = [m for m in load_training_materials() if m["id"] != item_id]
    save_training_materials(materials)
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Alert dashboard routes
# ---------------------------------------------------------------------------

EXT_TYPE_ORDER = ["挂牌督办", "管理约谈", "红黄牌", "处理通报", "停工令", "整改单", "违章培训通知单", "监理通知单"]
INT_TYPE_ORDER = ["停工令", "处理通报", "整改单", "违章培训通知单"]


@app.get("/alert")
def alert_page():
    return send_from_directory(app.static_folder + "/alert", "index.html")


@app.post("/api/alert/import")
def alert_import():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(error="请选择 Excel 文件"), 400
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify(error="请上传 .xlsx 或 .xls 文件"), 400
    file.save(ALERT_DATA_FILE)
    global _alert_data
    _alert_data = None
    try:
        data = load_alert_data()
        if not data:
            return jsonify(error="文件解析失败，请确认上传的是防城港三期安全管理数据总台账"), 400
        return jsonify(ok=True, updated=True,
                       external_count=len(data.get("external", [])),
                       internal_count=len(data.get("internal", [])))
    except Exception as exc:
        ALERT_DATA_FILE.unlink(missing_ok=True)
        _alert_data = {}
        return jsonify(error=f"文件解析失败: {exc}"), 400


def _filter_monthly(items, start, end):
    """Return items with 'total' aggregated from months overlapping [start, end].
    If start/end are empty, return unchanged (all months)."""
    if not start and not end:
        return items
    try:
        s_month = int(start[5:7]) if start else 1
        e_month = int(end[5:7]) if end else 12
    except (ValueError, IndexError):
        return items
    if s_month < 1: s_month = 1
    if e_month > 12: e_month = 12
    if s_month > e_month:
        s_month, e_month = e_month, s_month

    result = []
    for item in items:
        monthly = item.get("monthly", [])
        total = 0
        for m in range(s_month - 1, e_month):
            if m < len(monthly):
                total += monthly[m]
        result.append({**item, "total": total})
    return result


@app.get("/api/alert/summary")
def alert_summary():
    data = load_alert_data()
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    external = _filter_monthly(data.get("external", []), start, end)
    internal = _filter_monthly(data.get("internal", []), start, end)
    return jsonify({
        "external": external,
        "internal": internal,
        "months": data.get("months", []),
        "start": start,
        "end": end,
    })


@app.get("/api/alert/scores")
def alert_scores():
    data = load_alert_data()
    return jsonify(data.get("scores", {}))


def _aggregate_types(type_data, type_order):
    """Convert {type_name: count} to ordered list of {name, count}."""
    result = []
    for t in type_order:
        result.append({"name": t, "count": type_data.get(t, 0)})
    return result


def _aggregate_category(records, start, end, name_filter, category):
    """Aggregate type counts from detail_records filtered by date range."""
    types = {}
    for rec in records:
        if start and rec["date"] < start:
            continue
        if end and rec["date"] > end:
            continue
        if rec["category"] != category:
            continue
        if name_filter and rec["sub_name"] != name_filter and rec["dept_name"] != name_filter:
            continue
        tn = rec["type_name"]
        types[tn] = types.get(tn, 0) + 1
    total = sum(types.values())
    return types, total


def _build_bar_data(records, start, end, field):
    """Build ranking data from detail_records filtered by date range.
    field: 'sub_name' or 'dept_name'"""
    totals = {}
    for rec in records:
        if start and rec["date"] < start:
            continue
        if end and rec["date"] > end:
            continue
        name = rec.get(field, "")
        if not name:
            continue
        if name not in totals:
            totals[name] = {"external": 0, "internal": 0}
        totals[name][rec["category"]] += 1
    result = []
    for name, counts in totals.items():
        result.append({
            "name": name,
            "external": counts["external"],
            "internal": counts["internal"],
            "total": counts["external"] + counts["internal"],
        })
    result.sort(key=lambda x: -x["total"])
    return result


@app.get("/api/alert/departments")
def alert_departments():
    data = load_alert_data()
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    dept = request.args.get("dept", "").strip()

    records = data.get("detail_records", [])
    ext_types, ext_total = _aggregate_category(records, start, end, dept, "external")
    int_types, int_total = _aggregate_category(records, start, end, dept, "internal")

    return jsonify({
        "names": data.get("departments", {}).get("names", []),
        "external": data.get("departments", {}).get("external", []),
        "internal": data.get("departments", {}).get("internal", []),
        "external_types": _aggregate_types(ext_types, EXT_TYPE_ORDER),
        "internal_types": _aggregate_types(int_types, INT_TYPE_ORDER),
        "bar_data": _build_bar_data(records, start, end, "dept_name"),
        "start": start,
        "end": end,
    })


@app.get("/api/alert/subcontractors")
def alert_subcontractors():
    data = load_alert_data()
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    sub = request.args.get("sub", "").strip()

    records = data.get("detail_records", [])
    ext_types, ext_total = _aggregate_category(records, start, end, sub, "external")
    int_types, int_total = _aggregate_category(records, start, end, sub, "internal")

    bar_data = _build_bar_data(records, start, end, "sub_name")
    items = []
    for b in bar_data:
        items.append({"name": b["name"], "count": b["total"],
                       "external": b["external"], "internal": b["internal"]})

    return jsonify({
        "items": items,
        "external_types": _aggregate_types(ext_types, EXT_TYPE_ORDER),
        "internal_types": _aggregate_types(int_types, INT_TYPE_ORDER),
        "bar_data": bar_data,
        "start": start,
        "end": end,
    })


@app.get("/api/alert/type-stats")
def alert_type_stats():
    """Aggregate problem type statistics for pie/bar charts with optional filters."""
    data = load_alert_data()
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    category = request.args.get("category", "").strip()
    brake_type = request.args.get("type", "").strip()  # 预警刹车类型筛选

    records = data.get("detail_records", [])
    # Filter by date range, category, and brake type
    filtered = []
    for rec in records:
        if start and rec["date"] < start:
            continue
        if end and rec["date"] > end:
            continue
        if category and rec["category"] != category:
            continue
        if brake_type and rec["type_name"] != brake_type:
            continue
        # Only include records that have a problem_type
        if not rec.get("problem_type"):
            continue
        filtered.append(rec)

    # Aggregate by problem_type
    type_counts = {}
    for rec in filtered:
        pt = rec["problem_type"]
        cat = rec["category"]
        key = pt
        if key not in type_counts:
            type_counts[key] = {"name": pt, "count": 0, "external": 0, "internal": 0}
        type_counts[key]["count"] += 1
        if cat == "external":
            type_counts[key]["external"] += 1
        else:
            type_counts[key]["internal"] += 1

    type_list = sorted(type_counts.values(), key=lambda x: -x["count"])

    # Additional breakdowns for drill-down
    dept_counts = {}
    sub_counts = {}
    for rec in filtered:
        if rec["dept_name"]:
            dept_counts[rec["dept_name"]] = dept_counts.get(rec["dept_name"], 0) + 1
        if rec["sub_name"]:
            sub_counts[rec["sub_name"]] = sub_counts.get(rec["sub_name"], 0) + 1
    dept_list = sorted([{"name": k, "count": v} for k, v in dept_counts.items()], key=lambda x: -x["count"])
    sub_list = sorted([{"name": k, "count": v} for k, v in sub_counts.items()], key=lambda x: -x["count"])

    return jsonify({
        "type_counts": type_list,
        "dept_counts": dept_list,
        "sub_counts": sub_list,
        "start": start,
        "end": end,
    })


@app.get("/api/alert/details")
def alert_details():
    data = load_alert_data()
    detail_type = request.args.get("type", "").strip()
    sheet_map = {
        "挂牌督办": "工程公司挂牌督办单",
        "管理约谈": "工程公司管理约谈",
        "红黄牌": "红黄牌",
        "处理通报": "工程公司处理通报",
        "通报批评": "工程公司通报批评",
        "工程整改单": "工程公司整改单",
        "工程停工令": "工程公司停工令",
        "监理通知单": "监理业主整改通知单",
        "项目处理通报": "项目内部处理通报",
        "项目整改单": "项目整改通知单",
        "项目停工令": "项目停工令",
        "项目违章培训": "项目违章培训通知单",
        "工程违章培训": "工程公司违章培训通知单",
    }
    sheet_name = sheet_map.get(detail_type)
    if not sheet_name:
        return jsonify({"items": [], "total": 0})

    src = ALERT_DATA_FILE if ALERT_DATA_FILE.exists() else ALERT_SEED_FILE
    if not src.exists():
        return jsonify({"items": [], "total": 0})
    wb = load_workbook(src, data_only=True)
    if sheet_name not in wb.sheetnames:
        wb.close()
        return jsonify({"items": [], "total": 0})

    ws = wb[sheet_name]
    headers = []
    for c in range(1, ws.max_column + 1):
        h = ws.cell(row=1, column=c).value
        if h:
            headers.append(str(h).strip())

    items = []
    for r in range(2, ws.max_row + 1):
        row_vals = [str(ws.cell(row=r, column=c).value or "") for c in range(1, ws.max_column + 1)]
        if all(v == "" for v in row_vals):
            continue
        entry = {}
        for i, h in enumerate(headers):
            if i < len(row_vals):
                entry[h] = row_vals[i]
        items.append(entry)

    wb.close()
    page = int(request.args.get("page", 1))
    size = int(request.args.get("size", 20))
    total = len(items)
    start = (page - 1) * size
    return jsonify({"items": items[start:start + size], "total": total, "page": page, "size": size,
                    "headers": headers})


app.register_blueprint(admin_bp)
app.register_blueprint(meeting_bp)

init_db()
seed_people()
apply_role_rules()
seed_data()
load_alert_data()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("APP_PORT", "8010")), debug=os.environ.get("FLASK_DEBUG") == "1")
