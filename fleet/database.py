import sqlite3
import os
import csv
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fleet.db")
CSV_PATH = os.path.join(os.path.expanduser("~"), "Downloads", "govehicle-maintenance.csv")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def calculate_status(last_date_str, last_mileage, current_mileage, days_interval, miles_interval):
    """Calculate maintenance status: 'ok', 'soon', or 'overdue'."""
    try:
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d")
    except Exception:
        last_date = datetime.now() - timedelta(days=30)

    due_date = last_date + timedelta(days=days_interval)
    days_left = (due_date.date() - datetime.now().date()).days

    miles_left = None
    if miles_interval is not None and last_mileage is not None:
        due_mileage = last_mileage + miles_interval
        miles_left = due_mileage - current_mileage

    if days_left <= 0 or (miles_left is not None and miles_left <= 0):
        status = "overdue"
    elif days_left <= 14 or (miles_left is not None and miles_left <= 500):
        status = "soon"
    else:
        status = "ok"

    return {
        "status": status,
        "due_date": due_date.strftime("%Y-%m-%d"),
        "due_date_formatted": due_date.strftime("%d %b %Y"),
        "days_left": days_left,
        "due_mileage": (last_mileage + miles_interval) if miles_interval and last_mileage is not None else None,
        "miles_left": miles_left
    }

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS service_definitions (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        miles_interval INTEGER,
        days_interval INTEGER NOT NULL,
        base_cost REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        plate TEXT UNIQUE NOT NULL,
        mileage INTEGER NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        service_key TEXT NOT NULL,
        last_date TEXT NOT NULL,
        last_mileage INTEGER NOT NULL,
        last_cost REAL DEFAULT 0,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        FOREIGN KEY (service_key) REFERENCES service_definitions(key),
        UNIQUE(vehicle_id, service_key)
    );

    CREATE TABLE IF NOT EXISTS service_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        service_key TEXT NOT NULL,
        service_date TEXT NOT NULL,
        mileage INTEGER NOT NULL,
        cost REAL NOT NULL DEFAULT 0,
        notes TEXT,
        performed_by TEXT DEFAULT 'Fleet Technician',
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        FOREIGN KEY (service_key) REFERENCES service_definitions(key)
    );
    """)

    # Seed service definitions
    cursor.execute("SELECT COUNT(*) FROM service_definitions")
    if cursor.fetchone()[0] == 0:
        default_services = [
            ("oil", "Oil Change", 5000, 90, 1200),
            ("tires", "Tire Rotation", 6000, 180, 450),
            ("brakes", "Brake Inspection", 12000, 365, 900),
            ("fluids", "Fluid & Filter Check", 3000, 60, 650),
            ("dot", "DOT Inspection", None, 365, 2200)
        ]
        cursor.executemany(
            "INSERT INTO service_definitions (key, name, miles_interval, days_interval, base_cost) VALUES (?, ?, ?, ?, ?)",
            default_services
        )

    # Seed default user
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            ("admin", "admin123", "admin")
        )

    # Seed vehicles if table is empty
    cursor.execute("SELECT COUNT(*) FROM vehicles")
    if cursor.fetchone()[0] == 0:
        seed_vehicles_data(conn)

    conn.commit()
    conn.close()

def seed_vehicles_data(conn):
    cursor = conn.cursor()
    # Default fallback vehicles
    default_vehicles = [
        {"name": "Unit 04", "type": "Box Truck", "plate": "TRK-0412", "mileage": 88450},
        {"name": "Unit 07", "type": "Cargo Van", "plate": "VAN-0771", "mileage": 41220},
        {"name": "Unit 11", "type": "Box Truck", "plate": "TRK-1108", "mileage": 132900},
        {"name": "Unit 02", "type": "Sedan", "plate": "SDN-0223", "mileage": 22310},
        {"name": "Unit 09", "type": "Cargo Van", "plate": "VAN-0955", "mileage": 67840},
        {"name": "Unit 15", "type": "Flatbed", "plate": "FLT-1550", "mileage": 154200}
    ]

    # Service key mapping by name
    service_map = {
        "oil change": "oil",
        "tire rotation": "tires",
        "brake inspection": "brakes",
        "fluid & filter check": "fluids",
        "dot inspection": "dot"
    }

    inserted_vehicles = {}
    for v in default_vehicles:
        cursor.execute(
            "INSERT INTO vehicles (name, type, plate, mileage) VALUES (?, ?, ?, ?)",
            (v["name"], v["type"], v["plate"], v["mileage"])
        )
        inserted_vehicles[v["plate"]] = cursor.lastrowid

    # Fetch service definitions
    cursor.execute("SELECT key, name, days_interval, miles_interval, base_cost FROM service_definitions")
    defs = {r["key"]: dict(r) for r in cursor.fetchall()}

    # Initialize maintenance tasks with realistic varied historical dates
    today = datetime.now()
    offsets = {
        "oil": 45,       # halfway through 90 days
        "tires": 120,    # 120 days ago (due soon)
        "brakes": 180,   # halfway
        "fluids": 65,    # overdue! (exceeds 60 days)
        "dot": 200       # ok
    }

    for v in default_vehicles:
        vid = inserted_vehicles[v["plate"]]
        v_mileage = v["mileage"]

        for key, sdef in defs.items():
            days_ago = offsets.get(key, 30)
            last_date = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            miles_back = 2500 if key != "fluids" else 3200
            last_mileage = max(0, v_mileage - miles_back)
            last_cost = sdef["base_cost"]

            cursor.execute("""
            INSERT OR REPLACE INTO maintenance_tasks 
            (vehicle_id, service_key, last_date, last_mileage, last_cost)
            VALUES (?, ?, ?, ?, ?)
            """, (vid, key, last_date, last_mileage, last_cost))

            # Add an initial service log history record
            cursor.execute("""
            INSERT INTO service_logs
            (vehicle_id, service_key, service_date, mileage, cost, notes, performed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                vid,
                key,
                last_date,
                last_mileage,
                last_cost,
                f"Routine {sdef['name']} completed.",
                "Fleet Workshop"
            ))

    conn.commit()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at", DB_PATH)
