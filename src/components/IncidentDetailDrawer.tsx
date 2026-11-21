import {useState} from 'react';
import {CheckCircle2, Clock, MapPin, ShieldAlert, X} from 'lucide-react';
import type {IncidentCategory, IncidentRecord, IncidentStatus} from '../types.ts';
import {formatCoordinates, formatExactTimestamp, formatTimeAgo} from '../utils/geo.ts';

interface IncidentDetailDrawerProps {
  incident: IncidentRecord | null;
  onClose: () => void;
  isDispatcher: boolean;
  authToken: string | null;
  reportSecrets: Record<string, string>;
  onIncidentUpdated: (updated: IncidentRecord) => void;
}

const CATEGORIES: IncidentCategory[] = [
  'Accident',
  'Fire',
  'Harassment',
  'Medical',
  'Natural Hazard',
  'Suspicious Activity',
  'Other',
];

const STATUSES: IncidentStatus[] = ['Reported', 'Dispatched', 'On Scene', 'Resolved'];

function statusTone(status: IncidentStatus): string {
  switch (status) {
    case 'Resolved':
      return 'text-emerald-700';
    case 'On Scene':
      return 'text-amber-700';
    case 'Dispatched':
      return 'text-blue-700';
    default:
      return 'text-red-700';
  }
}

export function IncidentDetailDrawer({
  incident,
  onClose,
  isDispatcher,
  authToken,
  reportSecrets,
  onIncidentUpdated,
}: IncidentDetailDrawerProps) {
  const [nextStatus, setNextStatus] = useState<IncidentStatus>(incident?.status ?? 'Dispatched');
  const [dispatchNote, setDispatchNote] = useState('');
  const [editCategory, setEditCategory] = useState<IncidentCategory>(incident?.category ?? 'Other');
  const [editDescription, setEditDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!incident) return null;

  const secretForIncident = reportSecrets[incident.id];
  const canAppendDetails = Boolean(secretForIncident);

  async function handleDispatchUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!incident || !authToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(incident.id)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status: nextStatus,
          note: dispatchNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not update incident status.');
      } else {
        onIncidentUpdated(data.incident);
        setDispatchNote('');
        setSuccessMsg(`Status updated to ${nextStatus}.`);
      }
    } catch {
      setErrorMsg('Network error while updating dispatch status.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAppendDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!incident || !secretForIncident) return;
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(incident.id)}/details`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({
          reportSecret: secretForIncident,
          category: editCategory,
          description: editDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not save additional details.');
      } else {
        onIncidentUpdated(data.incident);
        setEditDescription('');
        setSuccessMsg('Incident details updated and broadcast to dispatch.');
      }
    } catch {
      setErrorMsg('Network error while updating incident details.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35"
      role="dialog"
      aria-modal="true"
      aria-label={`Incident details for ${incident.id}`}
    >
      <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{incident.id}</span>
              <span aria-hidden="true">·</span>
              <span>{incident.category}</span>
              <span aria-hidden="true">·</span>
              <span className={`font-semibold ${statusTone(incident.status)}`}>{incident.status}</span>
              <span aria-hidden="true">·</span>
              <span>{incident.reporterLabel}</span>
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-slate-900 leading-snug">
              {incident.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close incident details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-2 gap-4 pb-5 border-b border-slate-200 text-sm">
            <div>
              <div className="text-xs text-slate-500">GPS Coordinates</div>
              <div className="mt-1 font-mono text-xs font-medium text-slate-900 tabular-nums flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                {formatCoordinates(incident.latitude, incident.longitude)}
              </div>
              {incident.accuracyMeters !== null && (
                <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  Accuracy ±{incident.accuracyMeters}m
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">Location &amp; Reported</div>
              <div className="mt-1 font-medium text-slate-900">{incident.locationLabel}</div>
              <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                {formatTimeAgo(incident.createdAt)} · {formatExactTimestamp(incident.createdAt)}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-500">Incident Description</h3>
            <p className="mt-2 text-sm text-slate-800 leading-relaxed">{incident.description}</p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {canAppendDetails && (
            <form onSubmit={handleAppendDetails} className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                <span>Add Details to Your Active Report</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Incident Type</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as IncidentCategory)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Additional Situation Notes
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Describe injuries, hazards, suspect direction, or exact floor/unit..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submitting ? 'Updating...' : 'Send Update to Dispatch'}
              </button>
            </form>
          )}

          {isDispatcher && (
            <form onSubmit={handleDispatchUpdate} className="pt-4 border-t border-slate-200 space-y-3">
              <div className="text-sm font-semibold text-slate-900">Dispatcher Status Control</div>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setNextStatus(st)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      nextStatus === st
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Official Dispatch Note
                </label>
                <input
                  type="text"
                  required
                  value={dispatchNote}
                  onChange={(e) => setDispatchNote(e.target.value)}
                  placeholder="e.g. Unit 12 dispatched; ETA 3 minutes"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submitting ? 'Broadcasting...' : 'Broadcast Real-Time Update'}
              </button>
            </form>
          )}

          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500">Live Dispatch Timeline</h3>
            <div className="mt-3 space-y-3">
              {incident.updates.map((upd) => (
                <div key={upd.id} className="pb-3 border-b border-slate-100 last:border-b-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900">
                      {upd.status} · {upd.authorRole}
                    </span>
                    <span className="text-slate-500 font-mono tabular-nums flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatExactTimestamp(upd.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{upd.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
