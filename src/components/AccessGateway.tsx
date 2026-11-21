import {useEffect, useState} from 'react';
import {AlertTriangle, ArrowRight, CheckCircle2, Crosshair, Lock, Shield, UserCheck} from 'lucide-react';
import type {DispatcherStatusResponse, ResidentUser} from '../types.ts';
import {captureGpsPosition, formatCoordinates} from '../utils/geo.ts';
import type {GeoFix} from '../utils/geo.ts';

interface AccessGatewayProps {
  onAuthenticated: (token: string, user: ResidentUser) => void;
  onEmergencyBypass: () => void;
  onEmergencyDirectSos: () => void;
}

type GatewayTab = 'register' | 'login' | 'dispatcher';

const ID_TYPES = ['National ID', 'Driver License', 'Passport', 'Municipal Civic ID'] as const;

export function AccessGateway({
  onAuthenticated,
  onEmergencyBypass,
  onEmergencyDirectSos,
}: AccessGatewayProps) {
  const [tab, setTab] = useState<GatewayTab>('register');
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  // Registration fields
  const [fullName, setFullName] = useState('');
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>('National ID');
  const [idNumber, setIdNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [district, setDistrict] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [password, setPassword] = useState('');
  const [addressFix, setAddressFix] = useState<GeoFix | null>(null);
  const [gpsChecking, setGpsChecking] = useState(false);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string | null>(null);

  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Dispatcher fields
  const [dispatcherStatus, setDispatcherStatus] = useState<DispatcherStatusResponse | null>(null);
  const [dispatcherPasscode, setDispatcherPasscode] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dispatcher/status')
      .then((res) => res.json())
      .then((data: DispatcherStatusResponse) => setDispatcherStatus(data))
      .catch(() => setDispatcherStatus({configured: true, source: 'env'}));
  }, []);

  async function handleVerifyAddressGps() {
    setGpsChecking(true);
    setGpsStatusMsg(null);
    try {
      const fix = await captureGpsPosition();
      setAddressFix(fix);
      setGpsStatusMsg(`GPS verified at ${formatCoordinates(fix.latitude, fix.longitude)}`);
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as {message: string}).message)
          : 'Unable to read device GPS. You can still submit your residential address.';
      setGpsStatusMsg(message);
    } finally {
      setGpsChecking(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          fullName,
          idType,
          idNumber,
          phoneNumber,
          streetAddress,
          district,
          postalCode,
          password,
          verifiedLat: addressFix?.latitude ?? null,
          verifiedLng: addressFix?.longitude ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Registration failed. Please check all fields.');
      } else {
        onAuthenticated(data.token, data.user);
      }
    } catch {
      setErrorMsg('Network error while creating resident account.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          identifier: loginIdentifier,
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Sign-in failed.');
      } else {
        onAuthenticated(data.token, data.user);
      }
    } catch {
      setErrorMsg('Network error during sign-in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDispatcherSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    const endpoint =
      dispatcherStatus && !dispatcherStatus.configured
        ? '/api/dispatcher/claim'
        : '/api/dispatcher/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({passcode: dispatcherPasscode}),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Dispatcher authentication failed.');
      } else {
        onAuthenticated(data.token, data.user);
      }
    } catch {
      setErrorMsg('Network error while connecting to dispatch authentication.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-red-600 text-white rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-red-100">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Emergency Victim Bypass</span>
            </div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-white"
              style={{textWrap: 'balance'}}
            >
              Skip registration in an active emergency
            </h1>
            <p className="text-sm text-red-50 leading-relaxed">
              If you are experiencing an accident, fire, harassment, or medical threat, bypass the
              form immediately to transmit your live GPS location with a single button press.
            </p>
            <div className="pt-1 flex flex-col sm:flex-row lg:flex-col gap-3">
              <button
                type="button"
                onClick={onEmergencyDirectSos}
                className="w-full min-h-[46px] px-5 py-3 rounded-lg bg-white text-red-700 font-bold text-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Transmit Immediate GPS SOS</span>
              </button>
              <button
                type="button"
                onClick={onEmergencyBypass}
                className="w-full min-h-[44px] px-5 py-2.5 rounded-lg bg-red-700/90 text-white font-semibold text-sm hover:bg-red-800 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Skip Registration &amp; Enter Portal</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>

          <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="relative h-56 sm:h-64 lg:flex-1 min-h-[220px] bg-slate-900">
              {!heroImgFailed ? (
                <img
                  src="/src/assets/images/civic_safety_dispatch_1795275179550.jpg"
                  alt="Municipal public safety dispatch operations building at dusk"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-300">
                  <Shield className="w-10 h-10 text-slate-400 mb-3" />
                  <p className="text-sm font-semibold text-white">Municipal Emergency Response Network</p>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-5 text-white">
                <div className="text-xs text-slate-300">24/7 Civic Coordination</div>
                <p className="mt-1 text-sm font-semibold leading-snug">
                  Verified resident records accelerate dispatch routing while preserving anonymous
                  emergency access for victims.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Resident Safety Access</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Verify your identity, residential address, and phone number for full reporting.
                </p>
              </div>

              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setErrorMsg(null);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tab === 'register'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Register
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setErrorMsg(null);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tab === 'login'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Resident Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('dispatcher');
                    setErrorMsg(null);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tab === 'dispatcher'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Dispatcher
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                {errorMsg}
              </div>
            )}

            {tab === 'register' && (
              <form onSubmit={handleRegister} className="mt-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Full Legal Name (User Identification)
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Maya Lin Patel"
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Identification Document Type
                    </label>
                    <select
                      value={idType}
                      onChange={(e) => setIdType(e.target.value as (typeof ID_TYPES)[number])}
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {ID_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Identification Number
                    </label>
                    <input
                      type="text"
                      required
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      placeholder="e.g. NID-849201"
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Verified Mobile / Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. +1 415 555 0194"
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Residential Address Verification
                    </span>
                    <button
                      type="button"
                      onClick={handleVerifyAddressGps}
                      disabled={gpsChecking}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      {gpsChecking ? 'Locating GPS...' : 'Verify Address with GPS'}
                    </button>
                  </div>

                  {gpsStatusMsg && (
                    <div className="text-xs text-slate-700 flex items-center gap-2">
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          addressFix ? 'text-emerald-700' : 'text-amber-600'
                        }`}
                      />
                      <span className="font-mono">{gpsStatusMsg}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Street Address &amp; Unit
                      </label>
                      <input
                        type="text"
                        required
                        value={streetAddress}
                        onChange={(e) => setStreetAddress(e.target.value)}
                        placeholder="e.g. 742 Civic Plaza, Apt 4B"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        City / District
                      </label>
                      <input
                        type="text"
                        required
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        placeholder="e.g. Central Ward"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Postal Code
                      </label>
                      <input
                        type="text"
                        required
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                        placeholder="e.g. 94102"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Account Password (minimum 8 characters)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a secure password"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[44px] px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>{submitting ? 'Verifying & Creating Account...' : 'Complete Registration'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTab('login');
                      setErrorMsg(null);
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Already registered? Sign in
                  </button>
                </div>
              </form>
            )}

            {tab === 'login' && (
              <form onSubmit={handleLogin} className="mt-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Phone Number or Identification Number
                  </label>
                  <input
                    type="text"
                    required
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="Enter registered phone or ID number"
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[44px] px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{submitting ? 'Signing In...' : 'Sign In Securely'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTab('register');
                      setErrorMsg(null);
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Need an account? Register
                  </button>
                </div>
              </form>
            )}

            {tab === 'dispatcher' && (
              <form onSubmit={handleDispatcherSubmit} className="mt-6 space-y-5">
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700">
                  {dispatcherStatus && !dispatcherStatus.configured ? (
                    <>
                      <p className="font-semibold text-slate-900">
                        First-Run Dispatcher Passcode Setup
                      </p>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                        No dispatcher passcode has been claimed yet. Choose a passcode (minimum 8
                        characters) to claim municipal dispatch status controls for this server.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-900">Municipal Dispatcher Sign-In</p>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                        Enter the server dispatcher passcode to update incident response statuses
                        and broadcast official real-time safety updates.
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {dispatcherStatus && !dispatcherStatus.configured
                      ? 'Create Dispatcher Passcode'
                      : 'Dispatcher Passcode'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={dispatcherPasscode}
                    onChange={(e) => setDispatcherPasscode(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2 cursor-pointer"
                >
                  <Shield className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'Authenticating...'
                      : dispatcherStatus && !dispatcherStatus.configured
                        ? 'Claim & Enter Dispatch Console'
                        : 'Sign In as Dispatcher'}
                  </span>
                </button>
              </form>
            )}
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>Encrypted password storage · GPS coordinate verification</span>
            <span>Immediate Emergency Bypass available anytime</span>
          </div>
        </div>
      </div>
    </section>
  );
}
