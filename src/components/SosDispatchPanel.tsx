import {useState} from 'react';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Crosshair,
  Flame,
  HeartPulse,
  MapPin,
  Radio,
  ShieldAlert,
  Trees,
} from 'lucide-react';
import type {IncidentCategory, IncidentRecord, IncidentSeverity} from '../types.ts';
import type {GeoFix} from '../utils/geo.ts';
import {captureGpsPosition, formatCoordinates} from '../utils/geo.ts';

interface SosDispatchPanelProps {
  userFix: GeoFix | null;
  onUserFixChange: (fix: GeoFix) => void;
  authToken: string | null;
  onIncidentCreated: (incident: IncidentRecord, reportSecret?: string) => void;
  onInspectIncident: (incident: IncidentRecord) => void;
  pinPickingMode: boolean;
  onTogglePinPicking: () => void;
}

interface CategoryOption {
  value: IncidentCategory;
  label: string;
  hint: string;
  icon: typeof Car;
}

const INCIDENT_TYPES: CategoryOption[] = [
  {value: 'Accident', label: 'Traffic Accident', hint: 'Collision, rollover, pedestrian injury', icon: Car},
  {value: 'Fire', label: 'Fire & Explosion', hint: 'Building fire, smoke, gas leak', icon: Flame},
  {value: 'Harassment', label: 'Harassment & Assault', hint: 'Active threat, stalking, assault', icon: ShieldAlert},
  {value: 'Medical', label: 'Medical Emergency', hint: 'Trauma, cardiac, unconscious person', icon: HeartPulse},
  {value: 'Natural Hazard', label: 'Natural Hazard', hint: 'Flooding, downed power line, collapse', icon: Trees},
  {value: 'Suspicious Activity', label: 'Security & Theft', hint: 'Break-in, armed suspect, vandalism', icon: Radio},
  {value: 'Other', label: 'Other Emergency', hint: 'Custom emergency description', icon: AlertTriangle},
];

export function SosDispatchPanel({
  userFix,
  onUserFixChange,
  authToken,
  onIncidentCreated,
  onInspectIncident,
  pinPickingMode,
  onTogglePinPicking,
}: SosDispatchPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<IncidentCategory>('Accident');
  const [severity, setSeverity] = useState<IncidentSeverity>('High');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const [reportSending, setReportSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSosIncident, setLastSosIncident] = useState<IncidentRecord | null>(null);

  async function resolveCoordinatesForTransmit(): Promise<GeoFix | null> {
    if (userFix) return userFix;
    setGpsLoading(true);
    try {
      const fix = await captureGpsPosition();
      onUserFixChange(fix);
      return fix;
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as {message: string}).message)
          : 'GPS unavailable. Click the map to set your location pin.';
      setErrorMsg(msg);
      return null;
    } finally {
      setGpsLoading(false);
    }
  }

  async function handleOneTapSos() {
    setErrorMsg(null);
    setSosSending(true);
    try {
      const fix = await resolveCoordinatesForTransmit();
      if (!fix) {
        setSosSending(false);
        return;
      }

      const res = await fetch('/api/incidents/sos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({
          isSos: true,
          category: selectedCategory,
          severity: 'Critical',
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracyMeters,
          locationLabel: locationLabel.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to transmit SOS signal.');
      } else {
        setLastSosIncident(data.incident);
        onIncidentCreated(data.incident, data.reportSecret);
      }
    } catch {
      setErrorMsg('Network error while transmitting SOS signal.');
    } finally {
      setSosSending(false);
    }
  }

  async function handleCaptureGpsOnly() {
    setErrorMsg(null);
    setGpsLoading(true);
    try {
      const fix = await captureGpsPosition();
      onUserFixChange(fix);
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as {message: string}).message)
          : 'Unable to read GPS signal.';
      setErrorMsg(msg);
    } finally {
      setGpsLoading(false);
    }
  }

  async function handleStructuredSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setReportSending(true);

    try {
      const fix = await resolveCoordinatesForTransmit();
      if (!fix) {
        setReportSending(false);
        return;
      }

      const res = await fetch('/api/incidents/sos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({
          isSos: false,
          category: selectedCategory,
          severity,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          locationLabel: locationLabel.trim() || undefined,
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracyMeters,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to submit incident report.');
      } else {
        setLastSosIncident(data.incident);
        setTitle('');
        setDescription('');
        setLocationLabel('');
        onIncidentCreated(data.incident, data.reportSecret);
      }
    } catch {
      setErrorMsg('Network error while submitting incident report.');
    } finally {
      setReportSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-red-600 text-white rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-100">
          <span className="font-semibold">Single-Button Emergency Beacon</span>
          <span className="font-mono tabular-nums">
            {userFix
              ? `GPS Ready: ${formatCoordinates(userFix.latitude, userFix.longitude)}`
              : 'Auto-captures GPS on press'}
          </span>
        </div>

        <h2 className="text-xl font-bold leading-snug text-white">
          Instant GPS SOS Transmission
        </h2>
        <p className="text-sm text-red-50 leading-relaxed">
          Select an incident type below if safe to do so, or press immediately to transmit your
          exact location to dispatchers and nearby emergency responders.
        </p>

        <button
          type="button"
          onClick={handleOneTapSos}
          disabled={sosSending || gpsLoading}
          className="w-full min-h-[54px] px-6 py-3.5 rounded-lg bg-white text-red-700 font-bold text-base hover:bg-red-50 disabled:opacity-75 transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            {sosSending
              ? 'Transmitting GPS Beacon...'
              : gpsLoading
                ? 'Acquiring Precise GPS...'
                : `SEND SOS NOW (${selectedCategory.toUpperCase()})`}
          </span>
        </button>

        {lastSosIncident && (
          <div className="p-3.5 rounded-lg bg-red-700/90 text-xs text-white flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Transmitted <span className="font-mono font-bold">{lastSosIncident.id}</span> ·{' '}
                {lastSosIncident.category}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onInspectIncident(lastSosIncident)}
              className="underline font-semibold hover:text-red-100 cursor-pointer"
            >
              Add Details / Track Live
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">Report Incident with Details</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Choose the emergency type, pin GPS coordinates, and describe what is happening.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCaptureGpsOnly}
              disabled={gpsLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              {gpsLoading ? 'Locating...' : 'Capture GPS'}
            </button>
            <button
              type="button"
              onClick={onTogglePinPicking}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                pinPickingMode
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              {pinPickingMode ? 'Picking on Map...' : 'Pin Map'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleStructuredSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Incident Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {INCIDENT_TYPES.map((item) => {
                const Icon = item.icon;
                const active = selectedCategory === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSelectedCategory(item.value)}
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                    <div
                      className={`mt-0.5 text-[11px] truncate ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {item.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Urgency / Severity
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="Critical">Critical — Immediate Life/Safety Risk</option>
                <option value="High">High — Urgent Response Needed</option>
                <option value="Moderate">Moderate — Hazard / Non-Critical</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nearest Intersection / Landmark
              </label>
              <input
                type="text"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="e.g. Elm St & 3rd Ave Bus Stop"
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Short Headline
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Brief summary (e.g. ${selectedCategory} near transit station)`}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Situation Description
            </label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened, number of people involved, injuries, or immediate hazards..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-slate-600 font-mono tabular-nums">
              {userFix
                ? `Location: ${formatCoordinates(userFix.latitude, userFix.longitude)}`
                : 'GPS coordinates will be captured on submit'}
            </div>
            <button
              type="submit"
              disabled={reportSending || gpsLoading}
              className="min-h-[42px] px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {reportSending ? 'Submitting Report...' : 'Submit GPS Incident Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
