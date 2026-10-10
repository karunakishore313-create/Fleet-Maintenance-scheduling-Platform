import os
import io
import csv
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file, Response
from flask_cors import CORS
from database import get_connection, init_db, calculate_status

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/static"
)
CORS(app)

# Ensure database is initialized
init_db()

def get_enriched_tasks(conn, vehicle_id=None):
    """Retrieve maintenance tasks joined with vehicle and definition info, with dynamic status."""
    cursor = conn.cursor()
    query = """
    SELECT 
        mt.id AS task_id,
        mt.vehicle_id,
        mt.service_key,
        mt.last_date,
        mt.last_mileage,
        mt.last_cost,
        v.name AS vehicle_name,
        v.type AS vehicle_type,
        v.plate AS vehicle_plate,
        v.mileage AS current_mileage,
        sd.name AS service_name,
        sd.miles_interval,
        sd.days_interval,
        sd.base_cost
    FROM maintenance_tasks mt
    JOIN vehicles v ON mt.vehicle_id = v.id
    JOIN service_definitions sd ON mt.service_key = sd.key
    """
    params = ()
    if vehicle_id:
        query += " WHERE mt.vehicle_id = ?"
        params = (vehicle_id,)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    tasks = []
    for r in rows:
        calc = calculate_status(
            r["last_date"],
            r["last_mileage"],
            r["current_mileage"],
            r["days_interval"],
            r["miles_interval"]
        )
        task_data = {
            "id": r["task_id"],
            "vehicle_id": r["vehicle_id"],
            "vehicle_name": r["vehicle_name"],
            "vehicle_type": r["vehicle_type"],
            "vehicle_plate": r["vehicle_plate"],
            "current_mileage": r["current_mileage"],
            "service_key": r["service_key"],
            "service_name": r["service_name"],
            "miles_interval": r["miles_interval"],
            "days_interval": r["days_interval"],
            "last_date": r["last_date"],
            "last_mileage": r["last_mileage"],
            "last_cost": r["last_cost"],
            "status": calc["status"],
            "due_date": calc["due_date"],
            "due_date_formatted": calc["due_date_formatted"],
            "days_left": calc["days_left"],
            "due_mileage": calc["due_mileage"],
            "miles_left": calc["miles_left"]
        }
        tasks.append(task_data)
    return tasks

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "app": "Fleet Maintenance Platform", "timestamp": datetime.now().isoformat()})

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role FROM users WHERE username = ? AND password = ?", (username, password))
    user = cursor.fetchone()
    conn.close()

    if user:
        return jsonify({
            "message": "Login successful",
            "user": {"id": user["id"], "username": user["username"], "role": user["role"]}
        })
    # Accept default admin if matching standard dev credentials
    if username == "admin" and password == "admin123":
        return jsonify({
            "message": "Login successful",
            "user": {"id": 1, "username": "admin", "role": "admin"}
        })
    return jsonify({"error": "Invalid username or password"}), 401

@app.route("/api/stats", methods=["GET"])
def get_stats():
    conn = get_connection()
    tasks = get_enriched_tasks(conn)
    
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM vehicles")
    fleet_size = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(cost), 0) FROM service_logs")
    total_spend = cursor.fetchone()[0]
    conn.close()

    counts = {"ok": 0, "soon": 0, "overdue": 0}
    for t in tasks:
        counts[t["status"]] = counts.get(t["status"], 0) + 1

    return jsonify({
        "fleet_size": fleet_size,
        "on_track": counts["ok"],
        "due_soon": counts["soon"],
        "overdue": counts["overdue"],
        "total_spend": total_spend
    })

@app.route("/api/vehicles", methods=["GET"])
def get_vehicles():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM vehicles ORDER BY id ASC")
    vehicle_rows = cursor.fetchall()
    
    all_tasks = get_enriched_tasks(conn)
    conn.close()

    tasks_by_vehicle = {}
    for t in all_tasks:
        tasks_by_vehicle.setdefault(t["vehicle_id"], []).append(t)

    result = []
    for v in vehicle_rows:
        vid = v["id"]
        vtasks = tasks_by_vehicle.get(vid, [])
        total_tasks = len(vtasks)
        ok_tasks = sum(1 for t in vtasks if t["status"] == "ok")
        overdue_tasks = sum(1 for t in vtasks if t["status"] == "overdue")
        soon_tasks = sum(1 for t in vtasks if t["status"] == "soon")
        
        health_percent = int(round((ok_tasks / total_tasks * 100))) if total_tasks > 0 else 100
        overall_status = "overdue" if overdue_tasks > 0 else ("soon" if soon_tasks > 0 else "ok")

        result.append({
            "id": vid,
            "name": v["name"],
            "type": v["type"],
            "plate": v["plate"],
            "mileage": v["mileage"],
            "status": v["status"],
            "health_percent": health_percent,
            "overall_status": overall_status,
            "tasks": vtasks
        })

    return jsonify(result)

@app.route("/api/vehicles", methods=["POST"])
def add_vehicle():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    vtype = data.get("type", "Box Truck").strip()
    plate = data.get("plate", "").strip()
    mileage = int(data.get("mileage", 0))

    if not name:
        return jsonify({"error": "Vehicle name is required"}), 400
    if not plate:
        plate = f"UNIT-{datetime.now().strftime('%M%S')}"

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO vehicles (name, type, plate, mileage) VALUES (?, ?, ?, ?)",
            (name, vtype, plate, mileage)
        )
        vehicle_id = cursor.lastrowid

        # Attach default service tasks
        cursor.execute("SELECT key, base_cost FROM service_definitions")
        defs = cursor.fetchall()
        today_str = datetime.now().strftime("%Y-%m-%d")
        for d in defs:
            cursor.execute("""
            INSERT INTO maintenance_tasks (vehicle_id, service_key, last_date, last_mileage, last_cost)
            VALUES (?, ?, ?, ?, ?)
            """, (vehicle_id, d["key"], today_str, mileage, d["base_cost"]))

        conn.commit()
    except sqlite3.IntegrityError as e:
        conn.close()
        return jsonify({"error": f"Plate '{plate}' already exists"}), 400
    finally:
        conn.close()

    return jsonify({"message": "Vehicle added successfully", "id": vehicle_id}), 201

@app.route("/api/vehicles/<int:vid>", methods=["GET"])
def get_vehicle_detail(vid):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM vehicles WHERE id = ?", (vid,))
    vehicle = cursor.fetchone()
    if not vehicle:
        conn.close()
        return jsonify({"error": "Vehicle not found"}), 404

    tasks = get_enriched_tasks(conn, vehicle_id=vid)

    cursor.execute("""
    SELECT sl.*, sd.name AS service_name 
    FROM service_logs sl
    JOIN service_definitions sd ON sl.service_key = sd.key
    WHERE sl.vehicle_id = ?
    ORDER BY sl.service_date DESC, sl.id DESC
    """, (vid,))
    logs = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify({
        "id": vehicle["id"],
        "name": vehicle["name"],
        "type": vehicle["type"],
        "plate": vehicle["plate"],
        "mileage": vehicle["mileage"],
        "tasks": tasks,
        "history": logs
    })

@app.route("/api/vehicles/<int:vid>", methods=["PUT"])
def update_vehicle(vid):
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    vtype = data.get("type", "").strip()
    plate = data.get("plate", "").strip()
    mileage = int(data.get("mileage", 0))

    if not name:
        return jsonify({"error": "Vehicle name is required"}), 400

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE vehicles SET name = ?, type = ?, plate = ?, mileage = ? WHERE id = ?",
        (name, vtype, plate, mileage, vid)
    )
    conn.commit()
    conn.close()

    return jsonify({"message": "Vehicle updated successfully"})

@app.route("/api/vehicles/<int:vid>", methods=["DELETE"])
def delete_vehicle(vid):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM vehicles WHERE id = ?", (vid,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Vehicle deleted successfully"})

@app.route("/api/maintenance", methods=["GET"])
def get_maintenance():
    q = request.args.get("search", "").strip().lower()
    status_filter = request.args.get("status", "all").strip().lower()

    conn = get_connection()
    tasks = get_enriched_tasks(conn)
    conn.close()

    filtered = []
    for t in tasks:
        match_search = not q or (
            q in t["vehicle_name"].lower() or 
            q in t["vehicle_plate"].lower() or 
            q in t["service_name"].lower()
        )
        match_status = (status_filter == "all") or (t["status"] == status_filter)
        if match_search and match_status:
            filtered.append(t)

    # Sort overdue first, then soon, then ok
    status_order = {"overdue": 0, "soon": 1, "ok": 2}
    filtered.sort(key=lambda x: (status_order.get(x["status"], 3), x["due_date"]))

    return jsonify(filtered)

@app.route("/api/maintenance/log", methods=["POST"])
def log_maintenance():
    data = request.get_json() or {}
    vehicle_id = data.get("vehicle_id")
    service_key = data.get("service_key")
    cost = float(data.get("cost", 0))
    notes = data.get("notes", "Completed maintenance service.")
    performed_by = data.get("performed_by", "Fleet Technician")

    if not vehicle_id or not service_key:
        return jsonify({"error": "Vehicle ID and service key are required"}), 400

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT mileage FROM vehicles WHERE id = ?", (vehicle_id,))
    v = cursor.fetchone()
    if not v:
        conn.close()
        return jsonify({"error": "Vehicle not found"}), 404

    current_mileage = v["mileage"]
    today_str = datetime.now().strftime("%Y-%m-%d")

    # Update maintenance task record
    cursor.execute("""
    UPDATE maintenance_tasks 
    SET last_date = ?, last_mileage = ?, last_cost = ?
    WHERE vehicle_id = ? AND service_key = ?
    """, (today_str, current_mileage, cost, vehicle_id, service_key))

    # Append to service log history
    cursor.execute("""
    INSERT INTO service_logs (vehicle_id, service_key, service_date, mileage, cost, notes, performed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (vehicle_id, service_key, today_str, current_mileage, cost, notes, performed_by))

    conn.commit()
    conn.close()

    return jsonify({"message": "Service logged successfully", "date": today_str})

@app.route("/api/maintenance/logs", methods=["GET"])
def get_service_logs():
    limit = int(request.args.get("limit", 50))
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT sl.*, v.name AS vehicle_name, v.plate AS vehicle_plate, sd.name AS service_name
    FROM service_logs sl
    JOIN vehicles v ON sl.vehicle_id = v.id
    JOIN service_definitions sd ON sl.service_key = sd.key
    ORDER BY sl.id DESC
    LIMIT ?
    """, (limit,))
    logs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(logs)

@app.route("/api/export-csv", methods=["GET"])
def export_csv():
    conn = get_connection()
    tasks = get_enriched_tasks(conn)
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Vehicle", "Plate", "Service", "Due Date", "Status", "Last Cost", "Current Mileage"])

    for t in tasks:
        writer.writerow([
            t["vehicle_name"],
            t["vehicle_plate"],
            t["service_name"],
            t["due_date_formatted"],
            t["status"],
            t["last_cost"],
            t["current_mileage"]
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=fleet_maintenance_schedule.csv"}
    )

if __name__ == "__main__":
    print("Starting Fleet Maintenance Platform on http://127.0.0.1:5000 ...")
    app.run(host="127.0.0.1", port=5000, debug=True)