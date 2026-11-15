import os
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("ACCIDENT_DB_PATH", BASE_DIR / "accident_alert.db"))
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48)
TOKEN_MAX_AGE = 60 * 60 * 24 * 7
THRESHOLD = 70

app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
CORS(app, resources={r"/api/*": {"origins": os.environ.get("FRONTEND_ORIGIN", "*")}})
serializer = URLSafeTimedSerializer(SECRET_KEY, salt="accident-alert-auth")


def connect_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if bool(admin_email) != bool(admin_password):
        raise RuntimeError("Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision an admin account.")
    if admin_password and len(admin_password) < 12:
        raise RuntimeError("ADMIN_PASSWORD must contain at least 12 characters.")
    if admin_email and (
        len(admin_email) > 254
        or "@" not in admin_email
        or "." not in admin_email.rsplit("@", 1)[-1]
    ):
        raise RuntimeError("ADMIN_EMAIL must be a valid email address.")

    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect_db()) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'admin')),
                emergency_name TEXT NOT NULL DEFAULT '',
                emergency_phone TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                make TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                year INTEGER,
                plate TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS monitoring (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                active INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS accidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                impact INTEGER NOT NULL CHECK (impact BETWEEN 70 AND 100),
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        if admin_email:
            existing = db.execute(
                "SELECT id, password_hash, role FROM users WHERE email = ?",
                (admin_email,),
            ).fetchone()
            if not existing:
                db.execute(
                    """INSERT INTO users (name, email, password_hash, role, created_at)
                       VALUES (?, ?, ?, 'admin', ?)""",
                    ("System Admin", admin_email, generate_password_hash(admin_password), utc_now()),
                )
            elif existing["role"] != "admin":
                raise RuntimeError("ADMIN_EMAIL already belongs to a non-admin account.")
            elif not check_password_hash(existing["password_hash"], admin_password):
                db.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (generate_password_hash(admin_password), existing["id"]),
                )
        db.commit()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def public_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "emergencyName": row["emergency_name"],
        "emergencyPhone": row["emergency_phone"],
    }


def json_error(message, status):
    return jsonify({"error": message}), status


def request_json_object():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def parse_whole_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        value = value.strip()
        if value.isdecimal():
            return int(value)
    return None


def require_auth(role=None):
    def decorator(handler):
        @wraps(handler)
        def wrapped(*args, **kwargs):
            authorization = request.headers.get("Authorization", "")
            if not authorization.startswith("Bearer "):
                return json_error("Please sign in to continue.", 401)
            try:
                user_id = serializer.loads(authorization[7:], max_age=TOKEN_MAX_AGE)
            except SignatureExpired:
                return json_error("Your session expired. Please sign in again.", 401)
            except BadSignature:
                return json_error("Invalid session. Please sign in again.", 401)
            db = connect_db()
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            db.close()
            if not user:
                return json_error("Account not found.", 401)
            if role and user["role"] != role:
                return json_error("You do not have permission to access this resource.", 403)
            g.user = user
            return handler(*args, **kwargs)

        return wrapped
    return decorator


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "mode": "educational-simulation"})


@app.post("/api/auth/register")
def register():
    data = request_json_object()
    if data is None:
        return json_error("Request body must be a JSON object.", 400)
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    emergency_name = str(data.get("emergencyName", "")).strip()
    emergency_phone = str(data.get("emergencyPhone", "")).strip()
    if not name or len(name) > 80:
        return json_error("Enter a name between 1 and 80 characters.", 400)
    if len(email) > 254 or "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        return json_error("Enter a valid email address.", 400)
    if len(password) < 8:
        return json_error("Password must contain at least 8 characters.", 400)
    if not emergency_name or not emergency_phone or len(emergency_phone) > 30:
        return json_error("Enter an emergency contact name and phone number.", 400)
    db = connect_db()
    try:
        cursor = db.execute(
            """INSERT INTO users
               (name, email, password_hash, emergency_name, emergency_phone, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, email, generate_password_hash(password), emergency_name, emergency_phone, utc_now()),
        )
        user_id = cursor.lastrowid
        db.execute("INSERT INTO vehicles (user_id) VALUES (?)", (user_id,))
        db.execute("INSERT INTO monitoring (user_id) VALUES (?)", (user_id,))
        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        db.commit()
    except sqlite3.IntegrityError:
        db.close()
        return json_error("An account with this email already exists.", 409)
    db.close()
    return jsonify({"token": serializer.dumps(user_id), "user": public_user(user)}), 201


@app.post("/api/auth/login")
def login():
    data = request_json_object()
    if data is None:
        return json_error("Request body must be a JSON object.", 400)
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    db = connect_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    db.close()
    if not user or not check_password_hash(user["password_hash"], password):
        return json_error("Email or password is incorrect.", 401)
    return jsonify({"token": serializer.dumps(user["id"]), "user": public_user(user)})


@app.get("/api/auth/me")
@require_auth()
def me():
    return jsonify({"user": public_user(g.user)})


@app.get("/api/vehicle")
@require_auth()
def get_vehicle():
    db = connect_db()
    vehicle = db.execute("SELECT * FROM vehicles WHERE user_id = ?", (g.user["id"],)).fetchone()
    db.close()
    if not vehicle:
        return jsonify({"make": "", "model": "", "year": None, "plate": ""})
    return jsonify({key: vehicle[key] for key in ("make", "model", "year", "plate")})


@app.put("/api/vehicle")
@require_auth()
def update_vehicle():
    data = request_json_object()
    if data is None:
        return json_error("Request body must be a JSON object.", 400)
    make = str(data.get("make", "")).strip()
    model = str(data.get("model", "")).strip()
    plate = str(data.get("plate", "")).strip()
    year = data.get("year")
    if any(len(value) > 60 for value in (make, model, plate)):
        return json_error("Vehicle details are too long.", 400)
    if year not in (None, ""):
        year = parse_whole_number(year)
        if year is None:
            return json_error("Enter a valid vehicle year.", 400)
        if year < 1900 or year > datetime.now().year + 1:
            return json_error("Enter a valid vehicle year.", 400)
    else:
        year = None
    db = connect_db()
    db.execute(
        """INSERT INTO vehicles (user_id, make, model, year, plate)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
           make = excluded.make, model = excluded.model, year = excluded.year, plate = excluded.plate""",
        (g.user["id"], make, model, year, plate),
    )
    db.commit()
    db.close()
    return jsonify({"make": make, "model": model, "year": year, "plate": plate})


@app.get("/api/monitoring")
@require_auth()
def get_monitoring():
    db = connect_db()
    row = db.execute("SELECT active FROM monitoring WHERE user_id = ?", (g.user["id"],)).fetchone()
    db.close()
    return jsonify({"active": bool(row["active"]) if row else False, "threshold": THRESHOLD})


@app.put("/api/monitoring")
@require_auth()
def set_monitoring():
    data = request_json_object()
    if data is None:
        return json_error("Request body must be a JSON object.", 400)
    active = data.get("active")
    if not isinstance(active, bool):
        return json_error("Monitoring state must be true or false.", 400)
    db = connect_db()
    db.execute(
        """INSERT INTO monitoring (user_id, active) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET active = excluded.active""",
        (g.user["id"], int(active)),
    )
    db.commit()
    db.close()
    return jsonify({"active": active, "threshold": THRESHOLD})


@app.post("/api/accidents/simulate")
@require_auth()
def simulate_accident():
    data = request_json_object()
    if data is None:
        return json_error("Request body must be a JSON object.", 400)
    impact = parse_whole_number(data.get("impact"))
    if impact is None:
        return json_error("Impact must be a whole number from 0 to 100.", 400)
    if not 0 <= impact <= 100:
        return json_error("Impact must be between 0 and 100.", 400)
    db = connect_db()
    monitoring = db.execute("SELECT active FROM monitoring WHERE user_id = ?", (g.user["id"],)).fetchone()
    if not monitoring or not monitoring["active"]:
        db.close()
        return json_error("Start monitoring before running an impact simulation.", 409)
    if impact < THRESHOLD:
        db.close()
        return jsonify({"detected": False, "threshold": THRESHOLD})
    latitude = round(37.7749 + secrets.randbelow(2000) / 100000, 6)
    longitude = round(-122.4194 + secrets.randbelow(2000) / 100000, 6)
    created_at = utc_now()
    cursor = db.execute(
        """INSERT INTO accidents (user_id, impact, latitude, longitude, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (g.user["id"], impact, latitude, longitude, created_at),
    )
    accident_id = cursor.lastrowid
    db.commit()
    db.close()
    return jsonify({
        "detected": True,
        "threshold": THRESHOLD,
        "accident": {
            "id": accident_id,
            "impact": impact,
            "latitude": latitude,
            "longitude": longitude,
            "createdAt": created_at,
            "simulated": True,
        },
        "emergencyContact": {
            "name": g.user["emergency_name"],
            "phone": g.user["emergency_phone"],
        },
    }), 201


@app.get("/api/accidents")
@require_auth()
def accident_history():
    db = connect_db()
    rows = db.execute(
        """SELECT a.id, a.impact, a.latitude, a.longitude, a.created_at,
                  u.name AS driver_name, u.email AS driver_email
           FROM accidents a JOIN users u ON u.id = a.user_id
           WHERE (? = 'admin' OR a.user_id = ?)
           ORDER BY a.created_at DESC LIMIT 200""",
        (g.user["role"], g.user["id"]),
    ).fetchall()
    db.close()
    return jsonify({"accidents": [
        {
            "id": row["id"],
            "impact": row["impact"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "createdAt": row["created_at"],
            "driverName": row["driver_name"],
            "driverEmail": row["driver_email"],
            "simulated": True,
        }
        for row in rows
    ]})


@app.get("/api/admin/stats")
@require_auth(role="admin")
def admin_stats():
    db = connect_db()
    counts = db.execute(
        """SELECT
             (SELECT COUNT(*) FROM users WHERE role = 'driver') AS drivers,
             (SELECT COUNT(*) FROM accidents) AS accidents,
             (SELECT COUNT(*) FROM monitoring WHERE active = 1) AS monitoring,
             (SELECT COALESCE(AVG(impact), 0) FROM accidents) AS average_impact"""
    ).fetchone()
    recent = db.execute(
        """SELECT a.id, a.impact, a.latitude, a.longitude, a.created_at,
                  u.name AS driver_name, u.email AS driver_email
           FROM accidents a JOIN users u ON u.id = a.user_id
           ORDER BY a.created_at DESC LIMIT 10"""
    ).fetchall()
    db.close()
    return jsonify({
        "stats": {
            "drivers": counts["drivers"],
            "accidents": counts["accidents"],
            "monitoring": counts["monitoring"],
            "averageImpact": round(counts["average_impact"], 1),
        },
        "recentAccidents": [
            {
                "id": row["id"],
                "impact": row["impact"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "createdAt": row["created_at"],
                "driverName": row["driver_name"],
                "driverEmail": row["driver_email"],
                "simulated": True,
            }
            for row in recent
        ],
    })


initialize_database()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
