export type IncidentCategory =
  | 'Accident'
  | 'Fire'
  | 'Harassment'
  | 'Medical'
  | 'Natural Hazard'
  | 'Suspicious Activity'
  | 'Other';

export type IncidentSeverity = 'Critical' | 'High' | 'Moderate';

export type IncidentStatus = 'Reported' | 'Dispatched' | 'On Scene' | 'Resolved';

export type ReporterMode = 'verified_resident' | 'emergency_bypass';

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  status: IncidentStatus;
  note: string;
  authorRole: 'System' | 'Resident' | 'Dispatcher';
  createdAt: string;
}

export interface IncidentRecord {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  isSos: boolean;
  status: IncidentStatus;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationLabel: string;
  reporterMode: ReporterMode;
  reporterLabel: string;
  createdAt: string;
  updatedAt: string;
  updates: IncidentUpdate[];
}

export interface IncidentSummary {
  activeTotal: number;
  criticalCount: number;
  sosCount: number;
  resolvedCount: number;
}

export interface ResidentUser {
  id: string;
  role: 'resident' | 'dispatcher';
  fullName: string;
  idType?: string;
  idNumberMasked?: string;
  phoneMasked?: string;
  streetAddress?: string;
  district?: string;
  postalCode?: string;
  addressVerified?: boolean;
}

export interface DispatcherStatusResponse {
  configured: boolean;
  source: 'env' | 'claimed' | 'unclaimed';
}
