import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';

dotenv.config();

type IncidentCategory =
  | 'Accident'
  | 'Fire'
  | 'Harassment'
  | 'Medical'
  | 'Natural Hazard'
  | 'Suspicious Activity'
  | 'Other';

type IncidentSeverity = 'Critical' | 'High' | 'Moderate';
type IncidentStatus = 'Reported' | 'Dispatched' | 'On Scene' | 'Resolved';

interface SessionPayload {
  sub: string;
  role: 'resident' | 'dispatcher';
  name: string;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  auth?: SessionPayload;
}

const VALID_CATEGORIES: readonly IncidentCategory[] = [
  'Accident',
  'Fire',
  'Harassment',
  'Medical',
  'Natural Hazard',
  'Suspicious Activity',
  'Other',
];

const VALID_SEVERITIES: readonly IncidentSeverity[] = ['Critical', 'High', 'Moderate'];
const VALID_STATUSES: readonly IncidentStatus[] = ['Reported', 'Dispatched', 'On Scene', 'Resolved'];
const VALID_ID_TYPES = ['National ID', 'Driver License', 'Passport', 'Municipal Civic ID'] as const;

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, {recursive: true});
const dbPath = path.join(dataDir, 'safety.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS residents (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    id_type TEXT NOT NULL,
    id_number TEXT NOT NULL UNIQUE,
    phone_number TEXT NOT NULL UNIQUE,
    street_address TEXT NOT NULL,
    district TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    address_verified INTEGER NOT NULL DEFAULT 0,
    verified_lat REAL,
    verified_lng REAL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    is_sos INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy_meters REAL,
    location_label TEXT NOT NULL,
    reporter_mode TEXT NOT NULL,
    resident_id TEXT,
    reporter_label TEXT NOT NULL,
    report_secret_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incident_updates (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT NOT NULL,
    author_role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dispatcher_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    passcode_hash TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  );
`);

function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifySecret(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(plain, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function signToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.sub || !parsed.role || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.auth = payload;
    }
  }
  next();
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({error: 'Authentication required.'});
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({error: 'Session expired or invalid token.'});
    return;
  }
  req.auth = payload;
  next();
}

function maskString(value: string, visibleEnd = 4): string {
  const trimmed = value.trim();
  if (trimmed.length <= visibleEnd) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(Math.max(4, trimmed.length - visibleEnd))}${trimmed.slice(-visibleEnd)}`;
}

function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return Number(num.toFixed(6));
}

function seedBaselineIncidents(): void {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM incidents').get() as {count: number};
  if (countRow.count > 0) return;

  const now = Date.now();
  const seeded = [
    {
      id: 'INC-409182',
      category: 'Accident' as IncidentCategory,
      severity: 'High' as IncidentSeverity,
      isSos: 0,
      status: 'Dispatched' as IncidentStatus,
      title: 'Two-vehicle collision blocking northbound lane',
      description:
        'Intersection crash near Oak & 5th Ave. Airbags deployed; two occupants alert and awaiting traffic medical unit.',
      latitude: 37.7792,
      longitude: -122.4191,
      accuracyMeters: 12,
      locationLabel: 'Oak St & 5th Ave Corridor',
      reporterMode: 'verified_resident',
      reporterLabel: 'Verified Resident',
      createdAt: new Date(now - 18 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 9 * 60 * 1000).toISOString(),
      updates: [
        {
          status: 'Reported' as IncidentStatus,
          note: 'GPS-verified incident logged by neighborhood resident.',
          authorRole: 'System',
          offsetMs: 18 * 60 * 1000,
        },
        {
          status: 'Dispatched' as IncidentStatus,
          note: 'Unit M-14 and Traffic Patrol assigned. Expect 4-minute arrival.',
          authorRole: 'Dispatcher',
          offsetMs: 9 * 60 * 1000,
        },
      ],
    },
    {
      id: 'INC-409175',
      category: 'Fire' as IncidentCategory,
      severity: 'Critical' as IncidentSeverity,
      isSos: 1,
      status: 'On Scene' as IncidentStatus,
      title: 'Commercial transformer smoke and ground-floor fire',
      description:
        'Triggered via Emergency SOS button. Heavy electrical smoke visible near utility bay; perimeter evacuation underway.',
      latitude: 37.7834,
      longitude: -122.4089,
      accuracyMeters: 8,
      locationLabel: 'Market St Sector 3 Utility Bay',
      reporterMode: 'emergency_bypass',
      reporterLabel: 'Emergency SOS',
      createdAt: new Date(now - 34 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 6 * 60 * 1000).toISOString(),
      updates: [
        {
          status: 'Reported' as IncidentStatus,
          note: 'Immediate one-tap SOS GPS beacon transmitted.',
          authorRole: 'System',
          offsetMs: 34 * 60 * 1000,
        },
        {
          status: 'Dispatched' as IncidentStatus,
          note: 'Engine 07 and HazMat Power Isolation crew dispatched.',
          authorRole: 'Dispatcher',
          offsetMs: 31 * 60 * 1000,
        },
        {
          status: 'On Scene' as IncidentStatus,
          note: 'Fire suppression active. Surrounding block cordoned off.',
          authorRole: 'Dispatcher',
          offsetMs: 6 * 60 * 1000,
        },
      ],
    },
    {
      id: 'INC-409161',
      category: 'Natural Hazard' as IncidentCategory,
      severity: 'Moderate' as IncidentSeverity,
      isSos: 0,
      status: 'Dispatched' as IncidentStatus,
      title: 'Downed tree limb and low-hanging cable across sidewalk',
      description:
        'Large eucalyptus branch blocking pedestrian crossing and bike lane. Caution cones requested before evening commute.',
      latitude: 37.7689,
      longitude: -122.4265,
      accuracyMeters: 15,
      locationLabel: 'Dolores Park East Perimeter',
      reporterMode: 'verified_resident',
      reporterLabel: 'Verified Resident',
      createdAt: new Date(now - 52 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 24 * 60 * 1000).toISOString(),
      updates: [
        {
          status: 'Reported' as IncidentStatus,
          note: 'Hazard location pinned with resident GPS verification.',
          authorRole: 'System',
          offsetMs: 52 * 60 * 1000,
        },
        {
          status: 'Dispatched' as IncidentStatus,
          note: 'Public Works Crew 3 en route for clearance and utility check.',
          authorRole: 'Dispatcher',
          offsetMs: 24 * 60 * 1000,
        },
      ],
    },
    {
      id: 'INC-409144',
      category: 'Medical' as IncidentCategory,
      severity: 'High' as IncidentSeverity,
      isSos: 1,
      status: 'Resolved' as IncidentStatus,
      title: 'Acute respiratory distress at transit plaza',
      description:
        'Victim assisted at platform shelter; emergency paramedics stabilized patient and cleared scene.',
      latitude: 37.7745,
      longitude: -122.4142,
      accuracyMeters: 10,
      locationLabel: 'Civic Center Transit Plaza',
      reporterMode: 'emergency_bypass',
      reporterLabel: 'Emergency SOS',
      createdAt: new Date(now - 95 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 48 * 60 * 1000).toISOString(),
      updates: [
        {
          status: 'Reported' as IncidentStatus,
          note: 'Immediate one-tap SOS beacon transmitted.',
          authorRole: 'System',
          offsetMs: 95 * 60 * 1000,
        },
        {
          status: 'On Scene' as IncidentStatus,
          note: 'Paramedic Unit 02 arrived on scene.',
          authorRole: 'Dispatcher',
          offsetMs: 88 * 60 * 1000,
        },
        {
          status: 'Resolved' as IncidentStatus,
          note: 'Patient transported safely; plaza reopened.',
          authorRole: 'Dispatcher',
          offsetMs: 48 * 60 * 1000,
        },
      ],
    },
  ];

  const insertIncident = db.prepare(`
    INSERT INTO incidents (
      id, category, severity, is_sos, status, title, description,
      latitude, longitude, accuracy_meters, location_label,
      reporter_mode, resident_id, reporter_label, report_secret_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `);

  const insertUpdate = db.prepare(`
    INSERT INTO incident_updates (id, incident_id, status, note, author_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of seeded) {
    insertIncident.run(
      item.id,
      item.category,
      item.severity,
      item.isSos,
      item.status,
      item.title,
      item.description,
      item.latitude,
      item.longitude,
      item.accuracyMeters,
      item.locationLabel,
      item.reporterMode,
      item.reporterLabel,
      item.createdAt,
      item.updatedAt,
    );
    for (const upd of item.updates) {
      insertUpdate.run(
        `UPD-${crypto.randomUUID().slice(0, 8)}`,
        item.id,
        upd.status,
        upd.note,
        upd.authorRole,
        new Date(now - upd.offsetMs).toISOString(),
      );
    }
  }
}

seedBaselineIncidents();

interface IncidentRow {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  is_sos: number;
  status: IncidentStatus;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  location_label: string;
  reporter_mode: 'verified_resident' | 'emergency_bypass';
  reporter_label: string;
  created_at: string;
  updated_at: string;
}

interface UpdateRow {
  id: string;
  incident_id: string;
  status: IncidentStatus;
  note: string;
  author_role: 'System' | 'Resident' | 'Dispatcher';
  created_at: string;
}

function hydrateIncident(row: IncidentRow) {
  const updates = db
    .prepare(
      `SELECT id, incident_id, status, note, author_role, created_at
       FROM incident_updates
       WHERE incident_id = ?
       ORDER BY created_at DESC`,
    )
    .all(row.id) as unknown as UpdateRow[];

  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    isSos: Boolean(row.is_sos),
    status: row.status,
    title: row.title,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    locationLabel: row.location_label,
    reporterMode: row.reporter_mode,
    reporterLabel: row.reporter_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updates: updates.map((u) => ({
      id: u.id,
      incidentId: u.incident_id,
      status: u.status,
      note: u.note,
      authorRole: u.author_role,
      createdAt: u.created_at,
    })),
  };
}

function getSummary() {
  const rows = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END) AS activeTotal,
         SUM(CASE WHEN status != 'Resolved' AND severity = 'Critical' THEN 1 ELSE 0 END) AS criticalCount,
         SUM(CASE WHEN is_sos = 1 AND status != 'Resolved' THEN 1 ELSE 0 END) AS sosCount,
         SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolvedCount
       FROM incidents`,
    )
    .get() as {
      activeTotal: number | null;
      criticalCount: number | null;
      sosCount: number | null;
      resolvedCount: number | null;
    };

  return {
    activeTotal: rows.activeTotal ?? 0,
    criticalCount: rows.criticalCount ?? 0,
    sosCount: rows.sosCount ?? 0,
    resolvedCount: rows.resolvedCount ?? 0,
  };
}

const sseClients = new Set<Response>();

function broadcastSseEvent(eventName: string, payload: unknown): void {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '256kb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  app.post('/api/auth/register', (req, res) => {
    const fullName = cleanText(req.body?.fullName, 80);
    const idType = cleanText(req.body?.idType, 40);
    const idNumber = cleanText(req.body?.idNumber, 36).toUpperCase();
    const phoneNumber = cleanText(req.body?.phoneNumber, 24);
    const streetAddress = cleanText(req.body?.streetAddress, 140);
    const district = cleanText(req.body?.district, 60);
    const postalCode = cleanText(req.body?.postalCode, 20);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const verifiedLat =
      req.body?.verifiedLat !== undefined && req.body?.verifiedLat !== null
        ? parseCoordinate(req.body.verifiedLat, -90, 90)
        : null;
    const verifiedLng =
      req.body?.verifiedLng !== undefined && req.body?.verifiedLng !== null
        ? parseCoordinate(req.body.verifiedLng, -180, 180)
        : null;

    if (fullName.length < 2) {
      res.status(400).json({error: 'Full legal name is required.'});
      return;
    }
    if (!VALID_ID_TYPES.includes(idType as (typeof VALID_ID_TYPES)[number])) {
      res.status(400).json({error: 'Please select a valid identification document type.'});
      return;
    }
    if (!/^[A-Z0-9-]{4,36}$/.test(idNumber)) {
      res.status(400).json({error: 'Identification number must be 4-36 alphanumeric characters.'});
      return;
    }
    if (!/^[+0-9()\s-]{7,24}$/.test(phoneNumber)) {
      res.status(400).json({error: 'Please enter a valid phone number.'});
      return;
    }
    if (streetAddress.length < 5 || district.length < 2 || postalCode.length < 3) {
      res.status(400).json({error: 'Complete street address, district, and postal code are required.'});
      return;
    }
    if (password.length < 8) {
      res.status(400).json({error: 'Password must be at least 8 characters.'});
      return;
    }

    const existing = db
      .prepare('SELECT id FROM residents WHERE phone_number = ? OR id_number = ?')
      .get(phoneNumber, idNumber) as {id: string} | undefined;
    if (existing) {
      res.status(409).json({error: 'A resident account with this phone number or ID number already exists.'});
      return;
    }

    const residentId = `RES-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const addressVerified = verifiedLat !== null && verifiedLng !== null ? 1 : 0;
    const createdAt = new Date().toISOString();
    const passwordHash = hashSecret(password);

    db.prepare(`
      INSERT INTO residents (
        id, full_name, id_type, id_number, phone_number,
        street_address, district, postal_code, address_verified,
        verified_lat, verified_lng, password_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      residentId,
      fullName,
      idType,
      idNumber,
      phoneNumber,
      streetAddress,
      district,
      postalCode,
      addressVerified,
      verifiedLat,
      verifiedLng,
      passwordHash,
      createdAt,
    );

    const token = signToken({sub: residentId, role: 'resident', name: fullName});
    res.status(201).json({
      token,
      user: {
        id: residentId,
        role: 'resident',
        fullName,
        idType,
        idNumberMasked: maskString(idNumber),
        phoneMasked: maskString(phoneNumber),
        streetAddress,
        district,
        postalCode,
        addressVerified: Boolean(addressVerified),
      },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const identifier = cleanText(req.body?.identifier, 60);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      res.status(400).json({error: 'Phone number or ID number and password are required.'});
      return;
    }

    const row = db
      .prepare(
        `SELECT id, full_name, id_type, id_number, phone_number, street_address,
                district, postal_code, address_verified, password_hash
         FROM residents
         WHERE phone_number = ? OR id_number = ?`,
      )
      .get(identifier, identifier.toUpperCase()) as
      | {
          id: string;
          full_name: string;
          id_type: string;
          id_number: string;
          phone_number: string;
          street_address: string;
          district: string;
          postal_code: string;
          address_verified: number;
          password_hash: string;
        }
      | undefined;

    if (!row || !verifySecret(password, row.password_hash)) {
      res.status(401).json({error: 'Invalid phone/ID credentials or password.'});
      return;
    }

    const token = signToken({sub: row.id, role: 'resident', name: row.full_name});
    res.json({
      token,
      user: {
        id: row.id,
        role: 'resident',
        fullName: row.full_name,
        idType: row.id_type,
        idNumberMasked: maskString(row.id_number),
        phoneMasked: maskString(row.phone_number),
        streetAddress: row.street_address,
        district: row.district,
        postalCode: row.postal_code,
        addressVerified: Boolean(row.address_verified),
      },
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const auth = req.auth!;
    if (auth.role === 'dispatcher') {
      res.json({
        user: {
          id: auth.sub,
          role: 'dispatcher',
          fullName: 'Municipal Safety Dispatcher',
        },
      });
      return;
    }

    const row = db
      .prepare(
        `SELECT id, full_name, id_type, id_number, phone_number, street_address,
                district, postal_code, address_verified
         FROM residents WHERE id = ?`,
      )
      .get(auth.sub) as
      | {
          id: string;
          full_name: string;
          id_type: string;
          id_number: string;
          phone_number: string;
          street_address: string;
          district: string;
          postal_code: string;
          address_verified: number;
        }
      | undefined;

    if (!row) {
      res.status(404).json({error: 'Account not found.'});
      return;
    }

    res.json({
      user: {
        id: row.id,
        role: 'resident',
        fullName: row.full_name,
        idType: row.id_type,
        idNumberMasked: maskString(row.id_number),
        phoneMasked: maskString(row.phone_number),
        streetAddress: row.street_address,
        district: row.district,
        postalCode: row.postal_code,
        addressVerified: Boolean(row.address_verified),
      },
    });
  });

  app.get('/api/dispatcher/status', (_req, res) => {
    if (process.env.DISPATCH_PASSCODE && process.env.DISPATCH_PASSCODE.trim().length > 0) {
      res.json({configured: true, source: 'env'});
      return;
    }
    const row = db.prepare('SELECT id FROM dispatcher_config WHERE id = 1').get() as {id: number} | undefined;
    if (row) {
      res.json({configured: true, source: 'claimed'});
      return;
    }
    res.json({configured: false, source: 'unclaimed'});
  });

  app.post('/api/dispatcher/claim', (req, res) => {
    if (process.env.DISPATCH_PASSCODE && process.env.DISPATCH_PASSCODE.trim().length > 0) {
      res.status(403).json({error: 'Dispatcher passcode is already configured via environment secrets.'});
      return;
    }
    const existing = db.prepare('SELECT id FROM dispatcher_config WHERE id = 1').get() as {id: number} | undefined;
    if (existing) {
      res.status(409).json({error: 'Dispatcher passcode has already been claimed.'});
      return;
    }

    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (passcode.length < 8) {
      res.status(400).json({error: 'Dispatcher passcode must be at least 8 characters.'});
      return;
    }

    const passcodeHash = hashSecret(passcode);
    db.prepare('INSERT INTO dispatcher_config (id, passcode_hash, claimed_at) VALUES (1, ?, ?)').run(
      passcodeHash,
      new Date().toISOString(),
    );

    const token = signToken({sub: 'DISPATCHER-1', role: 'dispatcher', name: 'Municipal Safety Dispatcher'});
    res.status(201).json({
      token,
      user: {
        id: 'DISPATCHER-1',
        role: 'dispatcher',
        fullName: 'Municipal Safety Dispatcher',
      },
    });
  });

  app.post('/api/dispatcher/login', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (!passcode) {
      res.status(400).json({error: 'Dispatcher passcode is required.'});
      return;
    }

    const envPasscode = process.env.DISPATCH_PASSCODE?.trim();
    if (envPasscode && envPasscode.length > 0) {
      const a = Buffer.from(passcode);
      const b = Buffer.from(envPasscode);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({error: 'Invalid dispatcher passcode.'});
        return;
      }
    } else {
      const row = db.prepare('SELECT passcode_hash FROM dispatcher_config WHERE id = 1').get() as
        | {passcode_hash: string}
        | undefined;
      if (!row || !verifySecret(passcode, row.passcode_hash)) {
        res.status(401).json({error: 'Invalid dispatcher passcode.'});
        return;
      }
    }

    const token = signToken({sub: 'DISPATCHER-1', role: 'dispatcher', name: 'Municipal Safety Dispatcher'});
    res.json({
      token,
      user: {
        id: 'DISPATCHER-1',
        role: 'dispatcher',
        fullName: 'Municipal Safety Dispatcher',
      },
    });
  });

  app.get('/api/incidents', (req, res) => {
    const category = cleanText(req.query.category, 40);
    const status = cleanText(req.query.status, 30);
    const search = cleanText(req.query.search, 80);

    const clauses: string[] = [];
    const params: string[] = [];

    if (category && category !== 'All' && VALID_CATEGORIES.includes(category as IncidentCategory)) {
      clauses.push('category = ?');
      params.push(category);
    }
    if (status && status !== 'All' && VALID_STATUSES.includes(status as IncidentStatus)) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(title LIKE ? OR description LIKE ? OR location_label LIKE ? OR id LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT id, category, severity, is_sos, status, title, description,
                latitude, longitude, accuracy_meters, location_label,
                reporter_mode, reporter_label, created_at, updated_at
         FROM incidents
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(...params) as unknown as IncidentRow[];

    res.json({
      incidents: rows.map(hydrateIncident),
      summary: getSummary(),
    });
  });

  app.get('/api/incidents/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({connectedAt: new Date().toISOString()})}\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.post('/api/incidents/sos', optionalAuth, (req: AuthenticatedRequest, res) => {
    const rawCategory = cleanText(req.body?.category, 40);
    const category: IncidentCategory = VALID_CATEGORIES.includes(rawCategory as IncidentCategory)
      ? (rawCategory as IncidentCategory)
      : 'Other';

    const rawSeverity = cleanText(req.body?.severity, 20);
    const isSos = Boolean(req.body?.isSos);
    const severity: IncidentSeverity = isSos
      ? 'Critical'
      : VALID_SEVERITIES.includes(rawSeverity as IncidentSeverity)
        ? (rawSeverity as IncidentSeverity)
        : 'High';

    const latitude = parseCoordinate(req.body?.latitude, -90, 90);
    const longitude = parseCoordinate(req.body?.longitude, -180, 180);
    if (latitude === null || longitude === null) {
      res.status(400).json({error: 'Valid GPS latitude and longitude coordinates are required.'});
      return;
    }

    const accuracyRaw = req.body?.accuracyMeters;
    const accuracyMeters =
      typeof accuracyRaw === 'number' && Number.isFinite(accuracyRaw) && accuracyRaw >= 0
        ? Math.round(accuracyRaw)
        : null;

    const customTitle = cleanText(req.body?.title, 120);
    const customDescription = cleanText(req.body?.description, 1000);
    const customLocationLabel = cleanText(req.body?.locationLabel, 120);

    const title =
      customTitle ||
      (isSos
        ? `Immediate ${category} Emergency SOS`
        : `${category} Incident Reported`);
    const description =
      customDescription ||
      (isSos
        ? `Triggered via single-tap SOS emergency bypass. Exact GPS coordinates transmitted (${latitude.toFixed(5)}, ${longitude.toFixed(5)}).`
        : `GPS-located ${category.toLowerCase()} report submitted.`);
    const locationLabel =
      customLocationLabel || `GPS ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

    const isResident = req.auth?.role === 'resident';
    const reporterMode = isResident ? 'verified_resident' : 'emergency_bypass';
    const reporterLabel = isResident ? 'Verified Resident' : 'Emergency SOS';
    const residentId = isResident ? req.auth!.sub : null;

    const reportSecret = crypto.randomBytes(16).toString('hex');
    const reportSecretHash = hashSecret(reportSecret);

    const id = `INC-${crypto.randomInt(100000, 999999)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO incidents (
        id, category, severity, is_sos, status, title, description,
        latitude, longitude, accuracy_meters, location_label,
        reporter_mode, resident_id, reporter_label, report_secret_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Reported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      category,
      severity,
      isSos ? 1 : 0,
      title,
      description,
      latitude,
      longitude,
      accuracyMeters,
      locationLabel,
      reporterMode,
      residentId,
      reporterLabel,
      reportSecretHash,
      now,
      now,
    );

    const initialNote = isSos
      ? 'Immediate SOS beacon received with live GPS coordinates. Prioritized for nearest unit dispatch.'
      : 'Incident logged with GPS coordinates and added to active dispatch queue.';

    db.prepare(`
      INSERT INTO incident_updates (id, incident_id, status, note, author_role, created_at)
      VALUES (?, ?, 'Reported', ?, 'System', ?)
    `).run(`UPD-${crypto.randomUUID().slice(0, 8)}`, id, initialNote, now);

    const row = db
      .prepare(
        `SELECT id, category, severity, is_sos, status, title, description,
                latitude, longitude, accuracy_meters, location_label,
                reporter_mode, reporter_label, created_at, updated_at
         FROM incidents WHERE id = ?`,
      )
      .get(id) as unknown as IncidentRow;

    const hydrated = hydrateIncident(row);
    const summary = getSummary();
    broadcastSseEvent('incident_created', {incident: hydrated, summary});

    res.status(201).json({
      incident: hydrated,
      summary,
      reportSecret,
    });
  });

  app.patch('/api/incidents/:id/details', optionalAuth, (req: AuthenticatedRequest, res) => {
    const incidentId = cleanText(req.params.id, 30);
    const existing = db
      .prepare('SELECT id, resident_id, report_secret_hash, status FROM incidents WHERE id = ?')
      .get(incidentId) as
      | {id: string; resident_id: string | null; report_secret_hash: string | null; status: IncidentStatus}
      | undefined;

    if (!existing) {
      res.status(404).json({error: 'Incident not found.'});
      return;
    }

    const reportSecret = typeof req.body?.reportSecret === 'string' ? req.body.reportSecret : '';
    const isOwnerResident = req.auth?.role === 'resident' && existing.resident_id === req.auth.sub;
    const hasSecret = existing.report_secret_hash ? verifySecret(reportSecret, existing.report_secret_hash) : false;

    if (!isOwnerResident && !hasSecret) {
      res.status(403).json({error: 'Not authorized to append details to this incident.'});
      return;
    }

    const rawCategory = cleanText(req.body?.category, 40);
    const category: IncidentCategory | null = VALID_CATEGORIES.includes(rawCategory as IncidentCategory)
      ? (rawCategory as IncidentCategory)
      : null;
    const description = cleanText(req.body?.description, 1000);
    const title = cleanText(req.body?.title, 120);
    const locationLabel = cleanText(req.body?.locationLabel, 120);

    if (!category && !description && !title && !locationLabel) {
      res.status(400).json({error: 'Provide incident type or description details to update.'});
      return;
    }

    const now = new Date().toISOString();
    if (category) {
      db.prepare('UPDATE incidents SET category = ?, updated_at = ? WHERE id = ?').run(category, now, incidentId);
    }
    if (title) {
      db.prepare('UPDATE incidents SET title = ?, updated_at = ? WHERE id = ?').run(title, now, incidentId);
    }
    if (description) {
      db.prepare('UPDATE incidents SET description = ?, updated_at = ? WHERE id = ?').run(description, now, incidentId);
    }
    if (locationLabel) {
      db.prepare('UPDATE incidents SET location_label = ?, updated_at = ? WHERE id = ?').run(
        locationLabel,
        now,
        incidentId,
      );
    }

    db.prepare(`
      INSERT INTO incident_updates (id, incident_id, status, note, author_role, created_at)
      VALUES (?, ?, ?, ?, 'Resident', ?)
    `).run(
      `UPD-${crypto.randomUUID().slice(0, 8)}`,
      incidentId,
      existing.status,
      `Reporter appended incident details${category ? ` (${category})` : ''}.`,
      now,
    );

    const row = db
      .prepare(
        `SELECT id, category, severity, is_sos, status, title, description,
                latitude, longitude, accuracy_meters, location_label,
                reporter_mode, reporter_label, created_at, updated_at
         FROM incidents WHERE id = ?`,
      )
      .get(incidentId) as unknown as IncidentRow;

    const hydrated = hydrateIncident(row);
    const summary = getSummary();
    broadcastSseEvent('incident_updated', {incident: hydrated, summary});

    res.json({incident: hydrated, summary});
  });

  app.patch('/api/incidents/:id/status', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.auth?.role !== 'dispatcher') {
      res.status(403).json({error: 'Dispatcher authorization is required to update incident status.'});
      return;
    }

    const incidentId = cleanText(req.params.id, 30);
    const nextStatus = cleanText(req.body?.status, 30);
    const note = cleanText(req.body?.note, 400);

    if (!VALID_STATUSES.includes(nextStatus as IncidentStatus)) {
      res.status(400).json({error: 'Invalid incident status.'});
      return;
    }
    if (note.length < 3) {
      res.status(400).json({error: 'Please enter a brief dispatch update note.'});
      return;
    }

    const existing = db.prepare('SELECT id FROM incidents WHERE id = ?').get(incidentId) as {id: string} | undefined;
    if (!existing) {
      res.status(404).json({error: 'Incident not found.'});
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, incidentId);
    db.prepare(`
      INSERT INTO incident_updates (id, incident_id, status, note, author_role, created_at)
      VALUES (?, ?, ?, ?, 'Dispatcher', ?)
    `).run(`UPD-${crypto.randomUUID().slice(0, 8)}`, incidentId, nextStatus, note, now);

    const row = db
      .prepare(
        `SELECT id, category, severity, is_sos, status, title, description,
                latitude, longitude, accuracy_meters, location_label,
                reporter_mode, reporter_label, created_at, updated_at
         FROM incidents WHERE id = ?`,
      )
      .get(incidentId) as unknown as IncidentRow;

    const hydrated = hydrateIncident(row);
    const summary = getSummary();
    broadcastSseEvent('incident_updated', {incident: hydrated, summary});

    res.json({incident: hydrated, summary});
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CivicGuard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CivicGuard server:', err);
  process.exit(1);
});
