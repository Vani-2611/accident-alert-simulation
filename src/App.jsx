import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate } from './api.js';

const initialVehicle = { make: '', model: '', year: '', plate: '' };
const navItems = [
  { id: 'overview', icon: '⌂', label: 'Overview' },
  { id: 'vehicle', icon: '▣', label: 'Vehicle details' },
  { id: 'simulation', icon: '◉', label: 'Live simulation' },
  { id: 'history', icon: '◷', label: 'Accident history' },
];

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sentinel-user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('sentinel-token'));
  const [page, setPage] = useState('overview');
  const [authMode, setAuthMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [monitoring, setMonitoring] = useState(false);
  const [impact, setImpact] = useState(0);
  const [accidents, setAccidents] = useState([]);
  const [stats, setStats] = useState(null);
  const [alert, setAlert] = useState(null);

  const isAdmin = user?.role === 'admin';
  const loadData = useCallback(async () => {
    if (!token || !user) return;
    try {
      const requests = [
        api('/accidents', { token }),
        api('/monitoring', { token }),
      ];
      if (isAdmin) requests.push(api('/admin/stats', { token }));
      else requests.push(api('/vehicle', { token }));
      const [history, monitor, extra] = await Promise.all(requests);
      setAccidents(history.accidents);
      setMonitoring(monitor.active);
      if (isAdmin) setStats(extra);
      else setVehicle({ ...initialVehicle, ...extra, year: extra.year || '' });
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [token, user, isAdmin]);

  useEffect(() => {
    if (token && user) loadData();
  }, [token, user, loadData]);

  const setSession = (session) => {
    localStorage.setItem('sentinel-token', session.token);
    localStorage.setItem('sentinel-user', JSON.stringify(session.user));
    setToken(session.token);
    setUser(session.user);
    setPage('overview');
    setError('');
  };

  const logout = () => {
    localStorage.removeItem('sentinel-token');
    localStorage.removeItem('sentinel-user');
    setToken(null);
    setUser(null);
    setAccidents([]);
    setStats(null);
    setMonitoring(false);
    setAlert(null);
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const session = await api(`/auth/${authMode === 'login' ? 'login' : 'register'}`, {
        method: 'POST', body: JSON.stringify(body),
      });
      setSession(session);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleMonitoring = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api('/monitoring', {
        method: 'PUT', token, body: JSON.stringify({ active: !monitoring }),
      });
      setMonitoring(result.active);
      setNotice(result.active ? 'Monitoring simulation started.' : 'Monitoring simulation stopped.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const saveVehicle = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api('/vehicle', {
        method: 'PUT', token, body: JSON.stringify(vehicle),
      });
      setVehicle({ ...saved, year: saved.year || '' });
      setNotice('Vehicle details saved.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const runSimulation = async (simulatedImpact) => {
    if (!Number.isInteger(simulatedImpact) || simulatedImpact < 0 || simulatedImpact > 100) {
      setError('Impact must be a whole number from 0 to 100.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/accidents/simulate', {
        method: 'POST', token, body: JSON.stringify({ impact: simulatedImpact }),
      });
      if (result.detected) {
        setAlert(result);
        await loadData();
      } else {
        setNotice(`Impact ${impact} is below the simulated alert threshold of 70.`);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token || !user) {
    return <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} busy={busy} error={error} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>sentinel<span className="brand-light">drive</span></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="navigation">
          {(isAdmin ? [{ id: 'overview', icon: '▦', label: 'Admin dashboard' }, { id: 'history', icon: '◷', label: 'Incident reports' }] : navItems).map(item => (
            <button key={item.id} className={`nav-item ${page === item.id ? 'selected' : ''}`} onClick={() => { setPage(item.id); setError(''); setNotice(''); }}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === 'simulation' && monitoring && <span className="nav-live" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="simulation-note"><span className="note-icon">ⓘ</span><div><strong>Simulation only</strong><span>No real tracking or alerts</span></div></div>
          <div className="profile">
            <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="profile-copy"><strong>{user.name}</strong><span>{isAdmin ? 'Administrator' : 'Driver account'}</span></div>
            <button className="logout-icon" title="Sign out" onClick={logout}>↗</button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><div className="breadcrumb">Workspace <span>/</span> <b>{pageLabel(page, isAdmin)}</b></div></div>
          <div className="topbar-right"><span className="env-pill"><i /> SIMULATION ENVIRONMENT</span><button className="top-avatar" title="Sign out" onClick={logout}>{user.name.slice(0, 1).toUpperCase()}</button></div>
        </header>
        <section className="page-content">
          {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
          {notice && <div className="toast success-toast" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
          {isAdmin ? page === 'history' ? (
            <AdminReports accidents={accidents} />
          ) : (
            <AdminDashboard stats={stats} accidents={accidents} />
          ) : page === 'vehicle' ? (
            <VehiclePage vehicle={vehicle} setVehicle={setVehicle} onSave={saveVehicle} busy={busy} user={user} />
          ) : page === 'history' ? (
            <HistoryPage accidents={accidents} />
          ) : page === 'simulation' ? (
            <SimulationPage monitoring={monitoring} onToggle={toggleMonitoring} impact={impact} setImpact={setImpact} onSimulate={runSimulation} busy={busy} accidents={accidents} />
          ) : (
            <DriverDashboard user={user} vehicle={vehicle} monitoring={monitoring} onToggle={toggleMonitoring} accidents={accidents} onNavigate={setPage} busy={busy} />
          )}
        </section>
      </main>
      {alert && <AlertDialog result={alert} onClose={() => setAlert(null)} />}
    </div>
  );
}

function AuthPage({ mode, setMode, onSubmit, busy, error }) {
  return (
    <div className="auth-layout">
      <div className="auth-aside">
        <div className="brand brand-on-dark"><span className="brand-mark">S</span><span>sentinel<span className="brand-light">drive</span></span></div>
        <div className="auth-pitch"><div className="eyebrow"><span /> DIGITAL SAFETY LAB</div><h1>Prepared for the<br /><em>unexpected.</em></h1><p>A controlled environment to explore how impact alerts and driver safety systems work.</p>
          <div className="pitch-stat"><span className="pulse-ring">⌁</span><div><strong>70% impact threshold</strong><span>Configurable simulation trigger</span></div></div>
        </div>
        <div className="aside-bottom">A learning experience. Not an emergency service.</div>
      </div>
      <div className="auth-main">
        <form className="auth-card" onSubmit={onSubmit}>
          <div className="auth-kicker">WELCOME {mode === 'login' ? 'BACK' : 'ABOARD'}</div>
          <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h2>
          <p className="muted">{mode === 'login' ? 'Enter your details to continue to your dashboard.' : 'Set up a driver account for this simulation.'}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          {mode === 'register' && <Field label="Full name" name="name" placeholder="e.g. Alex Morgan" required maxLength={80} />}
          <Field label="Email address" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
          <Field label="Password" name="password" type="password" placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} minLength={mode === 'register' ? 8 : undefined} required autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          {mode === 'register' && <>
            <div className="form-section-label">EMERGENCY CONTACT <span>Simulation reference only</span></div>
            <Field label="Contact name" name="emergencyName" placeholder="Contact name" required />
            <Field label="Contact phone" name="emergencyPhone" type="tel" placeholder="Phone number" required maxLength={30} />
          </>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>→</span></button>
          <div className="auth-switch">{mode === 'login' ? 'New to Sentinel Drive?' : 'Already have an account?'} <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create account' : 'Sign in'}</button></div>
          <div className="demo-login">Admin access is provisioned through backend environment settings.</div>
        </form>
      </div>
    </div>
  );
}

function DriverDashboard({ user, vehicle, monitoring, onToggle, accidents, onNavigate, busy }) {
  const latest = accidents[0];
  return <>
    <PageHeading eyebrow="DRIVER WORKSPACE" title={`Good day, ${user.name.split(' ')[0]}`} subtitle="Here's the status of your safety simulation." />
    <div className="status-banner">
      <div className={`status-symbol ${monitoring ? 'is-on' : ''}`}>{monitoring ? '✓' : 'Ⅱ'}</div>
      <div className="status-message"><span className="status-label">{monitoring ? 'MONITORING ACTIVE' : 'MONITORING PAUSED'}</span><strong>{monitoring ? 'Your simulation is ready' : 'Your simulation is currently paused'}</strong><span>{monitoring ? 'Adjust impact intensity in the live simulation.' : 'Start monitoring to enable the impact simulator.'}</span></div>
      <button className={`button ${monitoring ? 'button-outline-light' : 'button-light'}`} onClick={() => onToggle()} disabled={busy}>{monitoring ? 'Stop monitoring' : 'Start monitoring'} <span>{monitoring ? 'Ⅱ' : '→'}</span></button>
    </div>
    <div className="section-title-row"><h2>At a glance</h2><span>YOUR SIMULATION OVERVIEW</span></div>
    <div className="stats-grid">
      <StatCard icon="◉" label="Monitoring" value={monitoring ? 'Active' : 'Paused'} detail={monitoring ? 'Ready for simulation' : 'Not currently running'} tone={monitoring ? 'green' : 'gray'} />
      <StatCard icon="▣" label="Registered vehicle" value={vehicle.make ? `${vehicle.make} ${vehicle.model}` : 'Not added'} detail={vehicle.plate || 'Add your vehicle details'} tone="blue" />
      <StatCard icon="◷" label="Simulated alerts" value={accidents.length} detail="Recorded in your history" tone="red" />
    </div>
    <div className="content-grid">
      <div className="panel recent-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest simulated events</p></div><button className="text-button" onClick={() => onNavigate('history')}>View history →</button></div>
        {latest ? <AccidentRow accident={latest} /> : <EmptyState title="Nothing to report" text="Your simulated events will appear here." />}
      </div>
      <div className="panel quick-panel"><div className="panel-heading"><div><h2>Quick access</h2><p>Manage your simulation</p></div></div>
        <button className="quick-link" onClick={() => onNavigate('simulation')}><span className="quick-icon red-icon">◉</span><span><b>Live simulation</b><small>Adjust impact and simulate</small></span><i>→</i></button>
        <button className="quick-link" onClick={() => onNavigate('vehicle')}><span className="quick-icon blue-icon">▣</span><span><b>Vehicle details</b><small>Update your vehicle profile</small></span><i>→</i></button>
      </div>
    </div>
    <div className="disclaimer"><b>Educational simulation only</b><span>GPS coordinates and impact events are generated for demonstration. This app does not contact emergency services or detect real accidents.</span></div>
  </>;
}

function SimulationPage({ monitoring, onToggle, impact, setImpact, onSimulate, busy, accidents }) {
  const ticks = useMemo(() => Array.from({ length: 11 }, (_, i) => i * 10), []);
  const latestLocation = accidents[0];
  const latitude = latestLocation?.latitude ?? 37.7749;
  const longitude = latestLocation?.longitude ?? -122.4194;
  return <>
    <PageHeading eyebrow="CONTROL CENTER" title="Live simulation" subtitle="Adjust a simulated impact to explore alert behavior." />
    <div className={`monitor-strip ${monitoring ? 'monitor-active' : ''}`}><span className="monitor-dot" /><div><strong>{monitoring ? 'Monitoring is active' : 'Monitoring is paused'}</strong><span>{monitoring ? 'Impact simulation is enabled for your session.' : 'Start monitoring before running a simulation.'}</span></div><button className={`button ${monitoring ? 'button-danger-outline' : 'button-primary'}`} onClick={() => onToggle()} disabled={busy}>{monitoring ? 'Stop monitoring' : 'Start monitoring'}</button></div>
    <div className="simulation-layout">
      <div className="panel impact-panel">
        <div className="panel-heading"><div><h2>Impact intensity</h2><p>Move the slider to set a simulated impact level.</p></div><span className="demo-tag">DEMO CONTROL</span></div>
        <div className="impact-readout"><strong className={impact >= 70 ? 'impact-high' : ''}>{impact}</strong><span>/ 100</span></div>
        <div className="slider-wrap"><input aria-label="Impact intensity" type="range" min="0" max="100" step="1" value={impact} onChange={(event) => { const next = Number(event.target.value); setImpact(next); if (monitoring && impact < 70 && next >= 70) onSimulate(next); }} style={{ '--range-progress': `${impact}%` }} /><div className="slider-ticks">{ticks.map(tick => <span key={tick} className={tick === 70 ? 'threshold-tick' : ''}>{tick}</span>)}</div><div className="threshold-marker" style={{ left: '70%' }}><span>ALERT THRESHOLD</span></div></div>
        <div className={`impact-guide ${impact >= 70 ? 'guide-alert' : ''}`}><span>{impact >= 70 ? '!' : 'i'}</span><div><strong>{impact >= 70 ? 'Threshold reached' : 'Threshold is 70'}</strong><small>{impact >= 70 ? 'A demo alert is generated automatically at this level.' : 'A simulated alert is generated at 70 or higher.'}</small></div></div>
        <button className="button button-primary simulate-button" disabled={!monitoring || busy} onClick={() => onSimulate(Number(impact))}>{busy ? 'Running simulation…' : 'Run impact simulation'} <span>→</span></button>
        {!monitoring && <p className="button-hint">Start monitoring to enable this control.</p>}
      </div>
      <div className="panel location-panel">
        <div className="panel-heading"><div><h2>Simulated location</h2><p>{latestLocation ? 'Last generated sample coordinates' : 'Sample coordinates for demonstration'}</p></div><span className="location-badge">DEMO GPS</span></div>
        <div className="map-placeholder"><div className="map-grid" /><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" /><div className="map-pin">●</div><span className="map-caption">SIMULATED LOCATION</span></div>
        <div className="coordinate-row"><span>Latitude</span><b>{Math.abs(latitude).toFixed(4)}° {latitude < 0 ? 'S' : 'N'}</b></div><div className="coordinate-row"><span>Longitude</span><b>{Math.abs(longitude).toFixed(4)}° {longitude < 0 ? 'W' : 'E'}</b></div>
        <div className="map-disclaimer">Coordinates shown are for demonstration only. No device location is accessed.</div>
      </div>
    </div>
    <div className="panel recent-panel simulation-recent"><div className="panel-heading"><div><h2>Recent simulated events</h2><p>{accidents.length} event{accidents.length === 1 ? '' : 's'} recorded</p></div></div>{accidents.length ? accidents.slice(0, 3).map(item => <AccidentRow key={item.id} accident={item} />) : <EmptyState title="No simulated events yet" text="Run a simulation at or above the threshold to create an event." />}</div>
    <div className="disclaimer"><b>Not an emergency service</b><span>This simulation does not provide real accident detection, GPS tracking, or emergency-service integration.</span></div>
  </>;
}

function VehiclePage({ vehicle, setVehicle, onSave, busy, user }) {
  const update = (key, value) => setVehicle({ ...vehicle, [key]: value });
  return <>
    <PageHeading eyebrow="DRIVER PROFILE" title="Vehicle details" subtitle="Manage the vehicle associated with your simulation profile." />
    <div className="vehicle-layout">
      <form className="panel vehicle-form" onSubmit={onSave}>
        <div className="panel-heading"><div><h2>Vehicle information</h2><p>Details are saved to your driver profile.</p></div><span className="profile-icon">▣</span></div>
        <div className="field-grid">
          <label className="field"><span>Make</span><input value={vehicle.make} maxLength="60" placeholder="e.g. Toyota" onChange={event => update('make', event.target.value)} /></label>
          <label className="field"><span>Model</span><input value={vehicle.model} maxLength="60" placeholder="e.g. Corolla" onChange={event => update('model', event.target.value)} /></label>
          <label className="field"><span>Year</span><input type="number" min="1900" max={new Date().getFullYear() + 1} value={vehicle.year} placeholder="2024" onChange={event => update('year', event.target.value)} /></label>
          <label className="field"><span>License plate <small>(optional)</small></span><input value={vehicle.plate} maxLength="60" placeholder="e.g. ABC 1234" onChange={event => update('plate', event.target.value)} /></label>
        </div>
        <div className="form-actions"><span>Only used within this educational demo.</span><button className="button button-primary" disabled={busy}>Save vehicle details <span>→</span></button></div>
      </form>
      <div className="panel contact-card"><div className="panel-heading"><div><h2>Emergency contact</h2><p>Provided during account setup</p></div><span className="contact-icon">♡</span></div><div className="contact-avatar">{user.emergencyName?.slice(0, 1).toUpperCase() || '—'}</div><h3>{user.emergencyName || 'No contact added'}</h3><span className="contact-phone">{user.emergencyPhone || 'Update your profile at registration'}</span><div className="contact-notice">This contact is displayed for simulation purposes only. No messages or calls are sent.</div></div>
    </div>
  </>;
}

function HistoryPage({ accidents }) {
  return <>
    <PageHeading eyebrow="EVENT LOG" title="Accident history" subtitle="Review impact events created in the simulation." />
    <div className="history-summary"><div><span className="summary-icon">◷</span><span><b>{accidents.length}</b><small>Total simulated events</small></span></div><span className="history-tag">SIMULATED DATA</span></div>
    <div className="panel history-panel">
      {accidents.length ? <div className="table-scroll"><table><thead><tr><th>EVENT</th><th>DATE &amp; TIME</th><th>IMPACT</th><th>SIMULATED LOCATION</th><th>STATUS</th></tr></thead><tbody>{accidents.map(item => <tr key={item.id}><td><div className="event-cell"><span className="event-bullet">!</span><span><b>Impact alert</b><small>Event #{String(item.id).padStart(4, '0')}</small></span></div></td><td>{formatDate(item.createdAt)}</td><td><span className="impact-pill">{item.impact}%</span></td><td>{item.latitude.toFixed(4)}°, {item.longitude.toFixed(4)}°</td><td><span className="resolved-pill">SIMULATED</span></td></tr>)}</tbody></table></div> : <EmptyState title="Your history is clear" text="Once you run a simulated impact event, it will appear here." />}
    </div>
    <div className="disclaimer"><b>Demo records only</b><span>Every entry is generated by a user-triggered simulation and does not represent a real incident.</span></div>
  </>;
}

function AdminDashboard({ stats, accidents }) {
  const values = stats?.stats;
  return <>
    <PageHeading eyebrow="SYSTEM OVERVIEW" title="Admin dashboard" subtitle="A snapshot of activity across the educational simulation." />
    <div className="admin-note"><span>ⓘ</span><div><b>Simulation environment</b><small>All metrics represent demo activity. No real-world incident monitoring is performed.</small></div></div>
    <div className="stats-grid admin-stats">
      <StatCard icon="♙" label="Driver accounts" value={values?.drivers ?? '—'} detail="Registered driver profiles" tone="blue" />
      <StatCard icon="◉" label="Simulated alerts" value={values?.accidents ?? '—'} detail="Impact threshold events" tone="red" />
      <StatCard icon="⌁" label="Active simulations" value={values?.monitoring ?? '—'} detail="Monitoring sessions active" tone="green" />
      <StatCard icon="↗" label="Average impact" value={`${values?.averageImpact ?? 0}%`} detail="Across simulated events" tone="amber" />
    </div>
    <div className="panel admin-report"><div className="panel-heading"><div><h2>Recent incident reports</h2><p>Latest simulated impact events across all driver accounts.</p></div><span className="report-count">{accidents.length} REPORTS</span></div>
      {accidents.length ? <div className="table-scroll"><table><thead><tr><th>DRIVER</th><th>DATE &amp; TIME</th><th>IMPACT</th><th>COORDINATES</th><th>TYPE</th></tr></thead><tbody>{accidents.map(item => <tr key={item.id}><td><div className="driver-cell"><span className="avatar small-avatar">{item.driverName.slice(0, 1).toUpperCase()}</span><span><b>{item.driverName}</b><small>{item.driverEmail}</small></span></div></td><td>{formatDate(item.createdAt)}</td><td><span className="impact-pill">{item.impact}%</span></td><td>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</td><td><span className="resolved-pill">SIMULATED</span></td></tr>)}</tbody></table></div> : <EmptyState title="No reports yet" text="Simulated impact events will appear here." />}
    </div>
  </>;
}

function AdminReports({ accidents }) {
  return <>
    <PageHeading eyebrow="SYSTEM REPORTS" title="Incident reports" subtitle="Review simulated impact events across all driver accounts." />
    <div className="history-summary"><div><span className="summary-icon">◷</span><span><b>{accidents.length}</b><small>Total simulated events</small></span></div><span className="history-tag">SIMULATED DATA</span></div>
    <div className="panel admin-report">
      {accidents.length ? <div className="table-scroll"><table><thead><tr><th>DRIVER</th><th>DATE &amp; TIME</th><th>IMPACT</th><th>COORDINATES</th><th>TYPE</th></tr></thead><tbody>{accidents.map(item => <tr key={item.id}><td><div className="driver-cell"><span className="avatar small-avatar">{item.driverName.slice(0, 1).toUpperCase()}</span><span><b>{item.driverName}</b><small>{item.driverEmail}</small></span></div></td><td>{formatDate(item.createdAt)}</td><td><span className="impact-pill">{item.impact}%</span></td><td>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</td><td><span className="resolved-pill">SIMULATED</span></td></tr>)}</tbody></table></div> : <EmptyState title="No reports yet" text="Simulated impact events will appear here." />}
    </div>
    <div className="disclaimer"><b>Demo records only</b><span>Reports contain simulated events only. No real-world incident monitoring is performed.</span></div>
  </>;
}

function AlertDialog({ result, onClose }) {
  const accident = result.accident;
  return <div className="modal-backdrop" role="presentation"><section className="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title">
    <div className="alert-icon">!</div><span className="alert-eyebrow">SIMULATED EVENT GENERATED</span><h2 id="alert-title">Impact threshold reached</h2><p>A simulated impact of <b>{accident.impact}%</b> was recorded. No emergency services were contacted.</p>
    <div className="alert-details"><div><span>SIMULATED LOCATION</span><b>{accident.latitude.toFixed(4)}° N, {Math.abs(accident.longitude).toFixed(4)}° W</b></div><div><span>EMERGENCY CONTACT REFERENCE</span><b>{result.emergencyContact.name} · {result.emergencyContact.phone}</b></div><div><span>EVENT TIME</span><b>{formatDate(accident.createdAt)}</b></div></div>
    <div className="alert-disclaimer">Educational demo only — this is not a real accident alert, GPS reading, or emergency-service notification.</div>
    <button className="button button-primary alert-close" onClick={onClose}>Acknowledge <span>✓</span></button>
  </section></div>;
}

function PageHeading({ eyebrow, title, subtitle }) {
  return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>;
}

function StatCard({ icon, label, value, detail, tone }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></div>;
}

function AccidentRow({ accident }) {
  return <div className="accident-row"><span className="accident-symbol">!</span><div className="accident-copy"><b>Simulated impact alert</b><span>{formatDate(accident.createdAt)}</span></div><span className="impact-pill">{accident.impact}%</span></div>;
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><span>◷</span><b>{title}</b><p>{text}</p></div>;
}

function Field({ label, name, ...props }) {
  return <label className="auth-field"><span>{label}</span><input name={name} {...props} /></label>;
}

function pageLabel(page, admin) {
  if (admin) return page === 'history' ? 'Incident reports' : 'Admin dashboard';
  return { overview: 'Overview', vehicle: 'Vehicle details', simulation: 'Live simulation', history: 'Accident history' }[page] || 'Overview';
}

export default App;
