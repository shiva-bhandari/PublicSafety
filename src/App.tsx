import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, LogOut, MapPin, Search, Shield, User} from 'lucide-react';
import {AccessGateway} from './components/AccessGateway.tsx';
import {IncidentDetailDrawer} from './components/IncidentDetailDrawer.tsx';
import {IncidentMap} from './components/IncidentMap.tsx';
import {SosDispatchPanel} from './components/SosDispatchPanel.tsx';
import type {
  IncidentCategory,
  IncidentRecord,
  IncidentStatus,
  IncidentSummary,
  ResidentUser,
} from './types.ts';
import type {GeoFix} from './utils/geo.ts';
import {captureGpsPosition, formatCoordinates, formatTimeAgo} from './utils/geo.ts';

type AppMode = 'gateway' | 'workspace';

const FILTER_CATEGORIES: ('All' | IncidentCategory)[] = [
  'All',
  'Accident',
  'Fire',
  'Harassment',
  'Medical',
  'Natural Hazard',
  'Suspicious Activity',
  'Other',
];

function statusTextColor(status: IncidentStatus): string {
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

export default function App() {
  const [mode, setMode] = useState<AppMode>('gateway');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ResidentUser | null>(null);
  const [emergencyBypassActive, setEmergencyBypassActive] = useState(false);

  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [summary, setSummary] = useState<IncidentSummary>({
    activeTotal: 0,
    criticalCount: 0,
    sosCount: 0,
    resolvedCount: 0,
  });
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<'All' | IncidentCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [userFix, setUserFix] = useState<GeoFix | null>(null);
  const [pinPickingMode, setPinPickingMode] = useState(false);
  const [reportSecrets, setReportSecrets] = useState<Record<string, string>>({});
  const [sosToast, setSosToast] = useState<string | null>(null);

  const reportSectionRef = useRef<HTMLDivElement | null>(null);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);
  const feedSectionRef = useRef<HTMLDivElement | null>(null);

  const fetchIncidents = useCallback(async () => {
    try {
      setFeedError(null);
      const res = await fetch('/api/incidents');
      if (!res.ok) throw new Error('Unable to load incidents');
      const data = await res.json();
      setIncidents(data.incidents);
      setSummary(data.summary);
    } catch {
      setFeedError('Unable to reach emergency incident feed. Retrying...');
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();

    const eventSource = new EventSource('/api/incidents/stream');
    eventSource.addEventListener('connected', () => {
      setLiveConnected(true);
    });
    eventSource.addEventListener('incident_created', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as {
          incident: IncidentRecord;
          summary: IncidentSummary;
        };
        setIncidents((prev) => {
          const withoutDup = prev.filter((item) => item.id !== parsed.incident.id);
          return [parsed.incident, ...withoutDup];
        });
        setSummary(parsed.summary);
      } catch {
        // ignore malformed event
      }
    });
    eventSource.addEventListener('incident_updated', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as {
          incident: IncidentRecord;
          summary: IncidentSummary;
        };
        setIncidents((prev) =>
          prev.map((item) => (item.id === parsed.incident.id ? parsed.incident : item)),
        );
        setSummary(parsed.summary);
      } catch {
        // ignore malformed event
      }
    });
    eventSource.onerror = () => {
      setLiveConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchIncidents]);

  const filteredIncidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return incidents.filter((item) => {
      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.locationLabel.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [incidents, categoryFilter, searchQuery]);

  const selectedIncident = useMemo(
    () => incidents.find((item) => item.id === selectedIncidentId) ?? null,
    [incidents, selectedIncidentId],
  );

  function handleAuthenticated(token: string, user: ResidentUser) {
    setAuthToken(token);
    setCurrentUser(user);
    setEmergencyBypassActive(false);
    setMode('workspace');
  }

  function handleEmergencyBypass() {
    setEmergencyBypassActive(true);
    setMode('workspace');
  }

  async function handleQuickHeaderSos() {
    setMode('workspace');
    setEmergencyBypassActive((prev) => prev || !currentUser);
    try {
      const fix = userFix ?? (await captureGpsPosition());
      setUserFix(fix);
      const res = await fetch('/api/incidents/sos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({
          isSos: true,
          category: 'Other',
          severity: 'Critical',
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracyMeters,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.reportSecret) {
          setReportSecrets((prev) => ({...prev, [data.incident.id]: data.reportSecret}));
        }
        setSelectedIncidentId(data.incident.id);
        setSosToast(`SOS transmitted (${data.incident.id}). Add incident details in the drawer if safe.`);
      }
    } catch {
      reportSectionRef.current?.scrollIntoView({behavior: 'smooth'});
      setSosToast('Grant GPS permission or click the map to pin your location before sending SOS.');
    }
  }

  function handleIncidentCreated(incident: IncidentRecord, reportSecret?: string) {
    setIncidents((prev) => {
      const withoutDup = prev.filter((item) => item.id !== incident.id);
      return [incident, ...withoutDup];
    });
    if (reportSecret) {
      setReportSecrets((prev) => ({...prev, [incident.id]: reportSecret}));
    }
    setSelectedIncidentId(incident.id);
    setSosToast(`Incident ${incident.id} is live on the dispatch feed.`);
  }

  function handleIncidentUpdated(updated: IncidentRecord) {
    setIncidents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }

  function handleSignOut() {
    setAuthToken(null);
    setCurrentUser(null);
    setEmergencyBypassActive(false);
    setMode('gateway');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setMode('gateway');
            }}
            className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            CivicGuard
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setMode('gateway')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Registration &amp; Access
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('workspace');
                setTimeout(() => mapSectionRef.current?.scrollIntoView({behavior: 'smooth'}), 40);
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Live Map
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('workspace');
                setTimeout(() => reportSectionRef.current?.scrollIntoView({behavior: 'smooth'}), 40);
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Report Incident
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('workspace');
                setTimeout(() => feedSectionRef.current?.scrollIntoView({behavior: 'smooth'}), 40);
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Emergency Updates
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleQuickHeaderSos}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>One-Tap SOS</span>
            </button>
          </div>
        </div>
      </header>

      {sosToast && (
        <div className="bg-slate-900 text-white text-xs px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <span>{sosToast}</span>
            <button
              type="button"
              onClick={() => setSosToast(null)}
              className="underline text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {mode === 'gateway' ? (
          <AccessGateway
            onAuthenticated={handleAuthenticated}
            onEmergencyBypass={handleEmergencyBypass}
            onEmergencyDirectSos={handleQuickHeaderSos}
          />
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {currentUser ? (
                  <>
                    <User className="w-4 h-4 text-slate-700 shrink-0" />
                    <span className="font-semibold text-slate-900">{currentUser.fullName}</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="text-xs text-slate-600">
                      {currentUser.role === 'dispatcher'
                        ? 'Authenticated Municipal Dispatcher'
                        : `Verified Resident (${currentUser.district ?? 'Registered'})`}
                    </span>
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="font-semibold text-slate-900">
                      {emergencyBypassActive ? 'Emergency Bypass Active' : 'Public Safety Guest View'}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="text-xs text-slate-600">
                      Registration skipped for immediate GPS SOS reporting
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-slate-600">
                  Stream: {liveConnected ? 'Real-Time Connected' : 'Syncing Updates'}
                </span>
                {currentUser ? (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMode('gateway')}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 font-semibold transition-colors cursor-pointer"
                  >
                    Register / Sign In
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Active Incidents</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                  {summary.activeTotal}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Critical Priority</div>
                <div className="mt-1 text-2xl font-bold text-red-600 font-mono tabular-nums">
                  {summary.criticalCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Active SOS Beacons</div>
                <div className="mt-1 text-2xl font-bold text-amber-600 font-mono tabular-nums">
                  {summary.sosCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Resolved Reports</div>
                <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
                  {summary.resolvedCount}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div ref={reportSectionRef} className="lg:col-span-5">
                <SosDispatchPanel
                  userFix={userFix}
                  onUserFixChange={setUserFix}
                  authToken={authToken}
                  onIncidentCreated={handleIncidentCreated}
                  onInspectIncident={(inc) => setSelectedIncidentId(inc.id)}
                  pinPickingMode={pinPickingMode}
                  onTogglePinPicking={() => setPinPickingMode((v) => !v)}
                />
              </div>

              <div ref={mapSectionRef} className="lg:col-span-7 space-y-6">
                <IncidentMap
                  incidents={filteredIncidents}
                  selectedIncidentId={selectedIncidentId}
                  onSelectIncident={(inc) => setSelectedIncidentId(inc.id)}
                  userFix={userFix}
                  pinPickingMode={pinPickingMode}
                  onTogglePinPicking={() => setPinPickingMode((v) => !v)}
                  onPickCoordinates={(lat, lng) => {
                    setUserFix({
                      latitude: lat,
                      longitude: lng,
                      accuracyMeters: null,
                      source: 'manual',
                    });
                    setPinPickingMode(false);
                  }}
                />
              </div>
            </div>

            <section ref={feedSectionRef} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Real-Time Emergency Updates &amp; Incident Log
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Live civic dispatch feed. Click any incident row to view full GPS telemetry
                      and timeline updates.
                    </p>
                  </div>

                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search ID, street, or type..."
                      className="w-full min-h-[38px] rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg w-fit">
                  {FILTER_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        categoryFilter === cat
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {feedError && (
                <div className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-800">
                  {feedError}
                </div>
              )}

              {loadingFeed ? (
                <div className="p-6 space-y-3">
                  <div className="h-10 bg-slate-100 rounded animate-pulse" />
                  <div className="h-10 bg-slate-100 rounded animate-pulse" />
                  <div className="h-10 bg-slate-100 rounded animate-pulse" />
                </div>
              ) : filteredIncidents.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <p className="text-sm font-semibold text-slate-900">
                    No incidents match your current filter
                  </p>
                  <p className="text-xs text-slate-600">
                    Clear your search or category filter to view all live emergency updates.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('All');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Incident</th>
                        <th className="py-3 px-4">Type &amp; Priority</th>
                        <th className="py-3 px-4">Location &amp; GPS</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredIncidents.map((inc) => {
                        const latestNote = inc.updates[0]?.note ?? inc.description;
                        return (
                          <tr
                            key={inc.id}
                            onClick={() => setSelectedIncidentId(inc.id)}
                            className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                              selectedIncidentId === inc.id ? 'bg-slate-50' : ''
                            }`}
                          >
                            <td className="py-3.5 px-4 align-top">
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {inc.id}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{inc.reporterLabel}</span>
                              </div>
                              <div className="mt-0.5 font-semibold text-slate-900">{inc.title}</div>
                              <div className="mt-0.5 text-xs text-slate-600 line-clamp-1">
                                {latestNote}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <div className="font-medium text-slate-900">{inc.category}</div>
                              <div
                                className={`text-xs ${
                                  inc.severity === 'Critical'
                                    ? 'text-red-600 font-semibold'
                                    : inc.severity === 'High'
                                      ? 'text-amber-700 font-medium'
                                      : 'text-slate-500'
                                }`}
                              >
                                {inc.severity}
                                {inc.isSos ? ' · SOS' : ''}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top">
                              <div className="text-slate-900 font-medium flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{inc.locationLabel}</span>
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                                {formatCoordinates(inc.latitude, inc.longitude)}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <span className={`font-semibold text-xs ${statusTextColor(inc.status)}`}>
                                {inc.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 align-top text-right whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums">
                              {formatTimeAgo(inc.updatedAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>CivicGuard Public Safety Portal</span>
          <span>For life-threatening emergencies also dial your local 911 / emergency number</span>
        </div>
      </footer>

      <IncidentDetailDrawer
        key={selectedIncident?.id ?? 'none'}
        incident={selectedIncident}
        onClose={() => setSelectedIncidentId(null)}
        isDispatcher={currentUser?.role === 'dispatcher'}
        authToken={authToken}
        reportSecrets={reportSecrets}
        onIncidentUpdated={handleIncidentUpdated}
      />
    </div>
  );
}
