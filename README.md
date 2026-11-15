# Sentinel Drive — Accident Alert Simulation

Sentinel Drive is an educational web application for exploring a simulated driver monitoring and accident-alert workflow. Drivers can manage a vehicle profile, start a monitoring session, adjust a simulated impact level, and review generated events. An administrator can view aggregate statistics and reports.

## Features

- Driver registration and sign-in
- Admin sign-in provisioned through backend environment settings
- Driver dashboard and vehicle details
- Start/stop monitoring controls
- 0–100 impact slider with a simulated alert at 70+
- Alert dialog with a generated sample coordinate and emergency-contact reference
- Persistent per-driver accident history
- Admin statistics and incident reports
- API validation and user-facing request errors

## Technology stack

- React 18 and Vite 6
- Python 3 and Flask REST API
- SQLite
- HTML, CSS, and JavaScript

## Project structure

```text
.
├── backend/
│   ├── app.py                 # Flask application and REST endpoints
│   ├── requirements.txt       # Python dependencies
│   └── tests/
│       └── test_api.py        # API and validation tests
├── src/
│   ├── App.jsx                # Application screens and interactions
│   ├── api.js                 # Frontend API client
│   ├── main.jsx               # React entry point
│   └── styles.css             # Responsive application styles
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js             # Vite development proxy for /api
├── .gitignore                 # Ignores local data, dependencies, and secrets
└── README.md
```

The local SQLite database is created at `backend\accident_alert.db` on first run. It contains account and simulation data and is intentionally excluded from Git.

## Requirements

- Node.js 18 or newer and npm
- Python 3.10 or newer

## Installation

Run these commands from the project directory in PowerShell:

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

If PowerShell blocks virtual-environment activation, use `.\.venv\Scripts\python.exe` in place of `python` for the Python commands.

## Start the application

Open two PowerShell terminals in the project directory.

### Terminal 1: Flask backend

Provision an administrator account with your own credentials. These values are not stored in the repository. The password must be at least 12 characters.

```powershell
$env:ADMIN_EMAIL = "admin@example.local"
$env:ADMIN_PASSWORD = Read-Host "Enter a unique admin password (12+ characters)"
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
python backend\app.py
```

The API listens at `http://127.0.0.1:5000`. Keep the same `SECRET_KEY` when restarting Flask if existing login tokens should remain valid. For an existing database, setting `ADMIN_EMAIL` to an existing administrator and providing a new `ADMIN_PASSWORD` updates that account's password hash; it does not delete the account or other data.

### Terminal 2: React + Vite frontend

```powershell
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Vite forwards `/api` requests to Flask. Keep both services running while using the app.

## API overview

Except for health, registration, and login, endpoints require a bearer token in the `Authorization` header.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Check API availability |
| `POST` | `/api/auth/register` | Register a driver |
| `POST` | `/api/auth/login` | Sign in a driver or administrator |
| `GET` | `/api/auth/me` | Get the current account |
| `GET`, `PUT` | `/api/vehicle` | Read or update vehicle details |
| `GET`, `PUT` | `/api/monitoring` | Read or update monitoring state |
| `POST` | `/api/accidents/simulate` | Submit an impact simulation |
| `GET` | `/api/accidents` | Read the current driver's history, or all events for an admin |
| `GET` | `/api/admin/stats` | Read administrator statistics and recent reports |

Simulation requests accept an integer impact from 0 to 100. An event is stored only when monitoring is active and impact is at least 70.

## Screenshots

Screenshots are not bundled yet. Add reviewed, non-sensitive captures under a `screenshots/` directory and link them here before publishing.

## Simulation disclaimer

This project is for education and demonstration only. It does **not** detect real accidents, access device GPS, track vehicles, send messages, call emergency services, or provide emergency response. All impact events and coordinates are simulated.

## Checks

```powershell
python -m unittest discover -s backend\tests -v
npm run build
```
