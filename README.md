# CivicGuard – Public Safety & Emergency Incident Portal

**A web-based public safety platform for emergency incident reporting, SOS alerts, location-based incident monitoring, and dispatcher coordination.**

CivicGuard is an academic software engineering project designed to demonstrate how digital technology can support public safety through structured incident reporting, GPS-based location capture, real-time incident updates, and centralized incident management.

> **Project status:** Academic prototype. This application does not directly contact police, ambulance, fire services, or other real-world emergency response agencies.

---

## 1. Project Overview

Emergency situations require timely communication, accurate location information, and effective coordination.

CivicGuard provides a centralized web application where users can submit emergency reports, send SOS alerts, and monitor incident information. Authorized dispatchers can review incidents and update their response status.

The project aims to demonstrate a technology-based approach to improving the organization and visibility of emergency incident information.

## 2. Key Features

### Emergency Reporting
- Submit structured incident reports.
- Select incident categories and severity levels.
- Include descriptions and location information.
- Capture GPS coordinates.

### SOS Emergency System
- One-tap SOS incident submission.
- Emergency bypass without resident registration.
- Automatic critical severity for SOS incidents.
- Unique incident identification.

### Incident Management
- Centralized incident dashboard.
- Incident status tracking.
- Incident categories and severity classification.
- Incident details and update history.

### Dispatcher Management
- Dispatcher authentication.
- Review submitted incidents.
- Update incident status.
- Add dispatcher notes.

### Live Updates
- Server-Sent Events (SSE).
- Live incident creation and update notifications.
- Automatic dashboard updates.

### Data Management
- SQLite database.
- Persistent incident records.
- Resident and dispatcher records.
- Incident update history.

## 3. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React 19 |
| Programming Language | TypeScript |
| Build Tool | Vite 8 |
| Backend | Node.js and Express.js |
| Database | SQLite |
| Maps | Leaflet |
| Icons | Lucide React |
| Styling | Tailwind CSS 4 |
| Real-time Communication | Server-Sent Events |
| Authentication | Password hashing and signed tokens |
| Android Module | Kotlin / Gradle |

## 4. Project Structure

```text
CivicGuard/
│
├── app/                       # Android application module
├── gradle/                    # Gradle configuration
│
├── src/
│   ├── assets/
│   │   └── images/
│   ├── components/
│   │   ├── AccessGateway.tsx
│   │   ├── IncidentDetailDrawer.tsx
│   │   ├── IncidentMap.tsx
│   │   └── SosDispatchPanel.tsx
│   ├── utils/
│   │   └── geo.ts
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   └── types.ts
│
├── data/                      # Local database (not committed)
├── server.ts                  # Express backend and API
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── .env.example
├── .gitignore
└── README.md
```

## 5. Installation and Setup

### Prerequisites

Install the following:

- Node.js (a version compatible with Vite 8)
- npm
- Git
- Visual Studio Code (recommended)

### Step 1: Clone the repository

```bash
git clone https://github.com/YOUR-USERNAME/CivicGuard.git
```

Replace `YOUR-USERNAME` with your GitHub username.

### Step 2: Open the project

```bash
cd CivicGuard
```

### Step 3: Install dependencies

```bash
npm ci
```

### Step 4: Configure environment variables

Create your local environment file from the example:

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env.local
```

Configure the required values in `.env.local` if needed.

| Variable | Description |
|---|---|
| GEMINI_API_KEY | Optional configuration placeholder; AI integration is not currently verified |
| APP_URL | Application hosting URL |
| DISPATCH_PASSCODE | Optional server-side dispatcher passcode |

Keep `.env.local` private. Never commit actual credentials or secrets.

### Step 5: Start the application

```bash
npm run dev
```

Open your browser:

```text
http://localhost:3000
```

The SQLite database is created automatically by the backend when the application starts.

## 6. Available Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install dependencies |
| `npm run dev` | Start the application in development mode |
| `npm run build` | Build the frontend for production |
| `npm run lint` | Run TypeScript checks |

## 7. Database

CivicGuard uses SQLite for local data persistence.

The database is created at:

```text
data/safety.db
```

The backend maintains the following main data entities:

- Residents
- Incidents
- Incident updates
- Dispatcher configuration

The local database is excluded from version control to prevent personal or test incident information from being published.

## 8. Security Considerations

The prototype includes:

- Password hashing using scrypt.
- Signed authentication tokens.
- Dispatcher authentication.
- Report-secret hashing.
- Environment-based configuration.
- Git exclusion rules for sensitive files.

This is an academic prototype, not a production-ready emergency response system. Additional security measures, privacy controls, identity verification, rate limiting, and deployment hardening are required before real-world use.

## 9. Current Limitations

- SOS alerts are stored and broadcast inside the application; they do not automatically notify emergency agencies.
- No verified integration with police, ambulance, or fire-service dispatch systems.
- No verified government identity or residential address verification.
- SMS and mobile push notifications are not implemented.
- Real-world deployment requires further security and reliability testing.
- The Android module has not yet been independently tested.

## 10. Future Enhancements

- Integration with verified emergency response services.
- SMS and push notification support.
- Nepal-specific administrative areas and emergency workflows.
- Improved resident identity verification.
- Advanced incident analytics and reporting.
- Enhanced role-based access control.
- Dedicated Android application integration.
- Disaster management and emergency resource coordination.

## 11. Academic Project

**Project Name:** CivicGuard – Public Safety & Emergency Incident Portal

**Project Type:** University Academic Project

**Domain:** Public Safety, Emergency Management and Web Application Development

**Developer:** Shiva Bhandari

---

*Built as an academic project to explore how software engineering can contribute to public safety and emergency incident management.*