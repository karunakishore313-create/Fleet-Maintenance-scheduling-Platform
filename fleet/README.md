# GoVehicle — Fleet Maintenance Scheduling Platform

A modern, full-stack Fleet Maintenance Scheduling Platform built with a Python Flask REST API, SQLite database persistence, and an interactive web dashboard.

---

## 🚀 Features

- **Fleet Dashboard**: Real-time KPI summary cards (Fleet Size, On Track, Due Soon, Overdue, Total Spend) and upcoming maintenance schedules.
- **Automated Preventive Scheduling**: Automatically tracks and alerts for recurring service milestones:
  - **Oil Change**: Every 5,000 miles or 90 days
  - **Tire Rotation**: Every 6,000 miles or 180 days
  - **Brake Inspection**: Every 12,000 miles or 365 days
  - **Fluid & Filter Check**: Every 3,000 miles or 60 days
  - **DOT Inspection**: Annual inspection (365 days)
- **Status Engine**: Dynamic status tagging (`On Track`, `Due Soon`, `Overdue`) based on elapsed days and current vehicle odometer readings.
- **Service Logging & History**: Log completed maintenance with cost (₹), repair notes, and technician identification. Keeps an audit trail in `service_logs`.
- **Vehicle Management (CRUD)**: Add new vehicles, update vehicle odometer/specifications, inspect maintenance health percentage, or retire vehicles.
- **Visual Analytics**: Interactive Chart.js visualizations for maintenance health distribution, odometer fleet utilization, and service frequency.
- **Report Export**: Instant server-side CSV export of fleet maintenance status.
- **Theme Support**: Dark mode and light mode toggle with preference persistence.
- **Authentication**: Role-ready login console (Default credentials: `admin` / `admin123`).

---

## 📁 Project Structure

```
fleet/
├── .venv/                   # Python virtual environment
├── app.py                   # Flask server & REST API endpoints
├── database.py              # SQLite schema, status engine, & auto-seeding
├── fleet.db                 # SQLite persistent database
├── requirements.txt         # Dependencies (Flask, Flask-CORS)
├── run.bat                  # 1-click Windows startup batch script
├── test_app.py              # Automated unit and API test suite
├── templates/
│   └── index.html           # Dashboard template
└── static/
    ├── css/styles.css       # Responsive design & theme styling
    └── js/app.js            # Frontend REST API client & Chart.js logic
```

---

## 🛠️ How to Run

### Option 1: One-Click Startup (Windows)
Double-click `run.bat` in the project folder.

### Option 2: Command Line
1. Open PowerShell or Command Prompt in `C:\Users\admin\Documents\fleet`.
2. Activate the virtual environment:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
3. Start the application:
   ```powershell
   python app.py
   ```
4. Open your browser and navigate to:
   ```
   http://127.0.0.1:5000
   ```

---

## 🔑 Login Credentials

- **Username**: `admin`
- **Password**: `admin123`

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status |
| `POST` | `/api/auth/login` | Authenticate user credentials |
| `GET` | `/api/stats` | Dynamic fleet KPI summary stats |
| `GET` | `/api/vehicles` | List all vehicles with health percentages and tasks |
| `POST` | `/api/vehicles` | Add new vehicle and attach default service schedules |
| `GET` | `/api/vehicles/<id>` | Get vehicle details and maintenance history |
| `PUT` | `/api/vehicles/<id>` | Update vehicle attributes and odometer |
| `DELETE` | `/api/vehicles/<id>` | Remove vehicle and associated task history |
| `GET` | `/api/maintenance` | Maintenance queue with search and status filters |
| `POST` | `/api/maintenance/log` | Log service completion, update last cost, and write history |
| `GET` | `/api/maintenance/logs` | Fetch audit logs of completed services |
| `GET` | `/api/export-csv` | Download CSV report of fleet maintenance schedule |

---

## 🧪 Testing

Run the automated test suite anytime with:
```powershell
.\.venv\Scripts\python.exe test_app.py
```
