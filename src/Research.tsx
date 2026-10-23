import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {displayError, downloadJSON, mutation, request, timestamp} from './api';
import {Badge, Empty, Panel} from './components';
import {cellFor, exactUSD, explainCode, isActive, label, pollDelay, ratioText, SERIES, type Detail, type Job, type Status} from './researchModel';

const within = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(15000)]);

export function Research() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Action errors stay until the next action; polling errors clear on the next good poll.
  const [actionError, setActionError] = useState('');
  const [pollError, setPollError] = useState('');
  const [symbol, setSymbol] = useState('AAPL');
  const [cik, setCIK] = useState('0000320193');
  const selectedRef = useRef('');
  const sequence = useRef(0);
  const applied = useRef(0);
  const pollNow = useRef<() => void>(() => {});

  // Each refresh has a sequence number. Only the newest response is applied, and a
  // detail is shown only if it is still for the selected job.
  const refresh = useCallback(async (signal: AbortSignal): Promise<Job[] | null> => {
    const n = ++sequence.current;
    const id = selectedRef.current;
    try {
      const [st, list] = await Promise.all([request<Status>('/research/status', {signal: within(signal)}), request<{jobs: Job[]}>('/research/jobs', {signal: within(signal)})]);
      const d = id ? await request<Detail>(`/research/jobs/${encodeURIComponent(id)}`, {signal: within(signal)}) : null;
      if (signal.aborted || n < applied.current) return list.jobs;
      applied.current = n;
      setStatus(st); setJobs(list.jobs); setPollError('');
      if (selectedRef.current === id) setDetail(d);
      return list.jobs;
    } catch (e) {
      if (!signal.aborted && n >= applied.current) setPollError(displayError(e));
      return null;
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0, generation = 0;
    const tick = async () => {
      const mine = ++generation;
      window.clearTimeout(timer);
      const list = await refresh(controller.signal);
      if (!controller.signal.aborted && mine === generation) timer = window.setTimeout(tick, list ? pollDelay(list) : 5000);
    };
    pollNow.current = () => void tick();
    void tick();
    return () => { controller.abort(); window.clearTimeout(timer); pollNow.current = () => {}; };
  }, [refresh]);

  const select = (id: string) => { selectedRef.current = id; setSelected(id); setDetail(null); setActionError(''); pollNow.current(); };
  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setActionError('');
    try { const j = await mutation<Job>('/research/jobs', {symbol, cik}); select(j.id); }
    catch (err) { setActionError(displayError(err)); }
    finally { setBusy(false); }
  };
  const download = async (kind: string, hash: string) => {
    if (!detail) return;
    try { await downloadJSON(`/research/jobs/${encodeURIComponent(detail.job.id)}/sources/${kind}?sha256=${hash}`, `${detail.job.symbol}-${kind}-${hash.slice(0, 12)}.json`, hash); }
    catch (e) { setActionError(displayError(e)); }
  };

  const job = detail?.job, report = job?.result;
  const cooling = status?.provider_cooldown_until && Date.parse(status.provider_cooldown_until) > Date.now() ? status.provider_cooldown_until : '';
  return <div className="research-workspace">
    <div className="notice"><div><strong>Official filings, with evidence.</strong> SEC annual financial research is separate from synthetic paper prices. Reports never authorize entries. Recent quarters, notes, auditor findings and licensed price history still need analysis.</div></div>
    {actionError && <div role="alert" className="notice error">{actionError}</div>}
    {pollError && <div className="notice error" aria-live="polite">Live updates are failing: {pollError} The last loaded research is shown.</div>}
    <Panel title="Research a US issuer" subtitle="Read-only public SEC filings · no brokerage connection" aside={<Badge tone="amber">RESEARCH ONLY</Badge>}><div className="panel-body">
      {!loading && status && !status.configured && <p className="notice error">SEC contact is not configured. Set an approved application name and contact email in the backend configuration, then restart the local app.</p>}
      {cooling && <p className="notice error">SEC limited access. Research is paused until {timestamp(cooling)}; queued jobs wait and nothing contacts SEC.</p>}
      <form className="research-form form" onSubmit={e => void start(e)}>
        <label>US ticker<input aria-label="US ticker" required maxLength={16} pattern="[A-Z][A-Z0-9.\-]*" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}/></label>
        <label>SEC CIK (10 digits)<input aria-label="SEC CIK" required pattern="[0-9]{10}" maxLength={10} value={cik} onChange={e => setCIK(e.target.value)}/></label>
        <button className="primary" disabled={busy || loading || !status?.configured}>{busy ? 'Queuing…' : 'Run SEC research'}</button>
      </form>
      <p className="small-note">Example: Apple · AAPL · 0000320193. The backend checks the ticker and issuer identity with SEC. EGX filings are not connected. Jobs and originals are saved locally; an interrupted job continues later, up to {status?.max_attempts ?? 3} attempts.</p>
    </div></Panel>
    <div className="research-grid">
      <Panel title="Research jobs" subtitle="Latest 50 requests · saved in PostgreSQL"><div className="research-jobs">
        {jobs.map(j => <button key={j.id} className={`research-job ${selected === j.id ? 'selected' : ''}`} aria-pressed={selected === j.id} onClick={() => select(j.id)}><strong>{j.symbol}</strong><Badge tone={j.status === 'FAILED' ? 'amber' : 'gray'}>{j.status}</Badge><span>{timestamp(j.created_at)} · attempt {j.attempts} of {j.max_attempts}</span></button>)}
        {!jobs.length && <Empty title={loading ? 'Loading research…' : 'No research jobs yet'}>Run a request to retrieve official SEC financial facts.</Empty>}
      </div></Panel>
      <div className="research-detail">{!selected ? <Panel title="Evidence workspace"><Empty title="Select or run a research job">Reported figures, calculations and original sources will appear here.</Empty></Panel>
        : !detail || !job ? <Panel title="Loading report"><Empty title="Retrieving saved research…">The result is read from the backend.</Empty></Panel> : <>
        <Panel title={report ? `${report.issuer} · ${report.symbol}` : `${job.symbol} · research job`} subtitle={`CIK ${job.cik} · attempt ${job.attempts} of ${job.max_attempts}`} aside={<Badge tone="amber">{job.status}</Badge>}><div className="panel-body">
          {isActive(job.status) && <p role="status">{job.status === 'QUEUED' && job.attempts > 0 ? 'Waiting for the next attempt…' : 'Retrieving official sources and analyzing annual financial contexts…'} This view refreshes automatically.</p>}
          {job.status === 'QUEUED' && job.last_error && <p className="small-note">Attempt {job.attempts} did not finish: {explainCode(job.last_error)}{job.next_attempt_at && <> Next attempt after {timestamp(job.next_attempt_at)}.</>}</p>}
          {job.status === 'FAILED' && <div role="alert" className="notice error"><div><strong>Research failed: {job.error_code}</strong> {explainCode(job.error_code)} No fallback data was substituted.</div></div>}
          {report && <><div className="toolbar"><Badge>{report.source}</Badge><Badge>{report.data_kind}</Badge><Badge tone="amber">{report.status}</Badge></div>
            <p className="small-note">As of {timestamp(report.as_of)} · {report.accounting_framework} · {report.currency}<br/>{report.scope}</p>
            <div className="detail-box"><strong>Entry outcome: {report.outcome}</strong>Entry eligible: {report.eligible_for_entry ? 'Yes' : 'No'} · Historical backtest eligible: {report.eligible_for_backtest ? 'Yes' : 'No'}<br/>Parser version: {report.version}. No return forecast is produced.</div></>}
        </div></Panel>
        {report && <>
          <Panel title="Annual financial series" subtitle="Reported USD figures from each year's original annual report"><div className="table-wrap"><table><thead><tr><th>Fiscal year</th>{SERIES.map(m => <th key={m}>{label(m)}</th>)}<th>Annual report</th></tr></thead><tbody>
            {report.periods.map(p => <tr key={p.fiscal_period_end}><td>{p.start ?? '—'}<div className="sub">to {p.fiscal_period_end}</div></td>
              {SERIES.map(m => { const c = cellFor(p, m); return <td className={c.tone === 'value' ? 'mono' : 'sub'} key={m}>{c.text}</td>; })}
              <td><a href={p.filing.filing_url} target="_blank" rel="noreferrer">{p.filing.form} {p.filing.accession}</a><div className="sub">Filed {p.filing.filed}</div></td></tr>)}
          </tbody></table>{!report.periods.length && <Empty title="No annual report context">The sources did not contain a usable original annual report. Missing data does not mean zero.</Empty>}</div></Panel>
          {report.periods.map(p => <Panel key={p.fiscal_period_end} title={`Fiscal year ending ${p.fiscal_period_end}`} subtitle={`${p.filing.form} ${p.filing.accession} · ${p.filing.accepted_at ? `accepted by SEC ${timestamp(p.filing.accepted_at)}` : 'acceptance time not indexed; availability estimated'}`}><div className="panel-body">
            <div className="derived-metrics">{Object.entries(p.derived).map(([name, d]) => <div className="detail-box" key={name}><strong>{label(name)}</strong><span className="mono">{ratioText(name, d)}</span><div className="sub">{label(d.status)} · {d.inputs.map(label).join(' / ')}{d.value !== null && ` · ${d.value}`}</div></div>)}</div>
            {p.checks.map(c => <p className="small-note" key={c.name}>{label(c.name)}: <strong>{label(c.status)}</strong>{c.difference_usd !== undefined && ` · difference ${exactUSD(c.difference_usd)}`}</p>)}
            {p.missing_metrics.length > 0 && <p className="small-note">Not reported in this filing: {p.missing_metrics.map(label).join(', ')}</p>}
            {p.withheld_metrics.map(w => <p className="small-note" key={w.metric}>Withheld {label(w.metric)} ({w.tag}): {label(w.reason)} · values {w.values.map(exactUSD).join(' / ')}</p>)}
            {p.later_filing_differences.length > 0 && <div className="detail-box"><strong>Later filings report different values</strong>{p.later_filing_differences.map((d, i) => <div className="sub" key={i}>{label(d.metric)}: {exactUSD(d.original_value)} originally → {exactUSD(d.later_value)} in {d.later_form} {d.later_accession} (filed {d.later_filed})</div>)}</div>}
            <details><summary>Inspect reported facts and citations</summary>{p.facts.map(f => <div className="fact-evidence" key={f.metric}><strong>{label(f.metric)} · {exactUSD(f.value)}</strong><p className="small-note">{f.tag} · {f.unit} · {f.form}<br/>{f.start ? `${f.start} to ${f.end}` : `At ${f.end}`} · filed {f.filed} · available {timestamp(f.available_at)} ({label(f.availability_basis)})</p><a href={f.filing_url} target="_blank" rel="noreferrer">SEC filing {f.accession}</a><p className="mono">Source SHA-256: {f.source_sha256}<br/>JSON pointer: {f.pointer}</p></div>)}</details>
          </div></Panel>)}
          <Panel title="Limitations and counter-evidence" subtitle="These gaps prevent a complete financial or trading assessment"><div className="panel-body">
            <ul className="research-warnings">{report.warnings.map(w => <li key={w}>{label(w)}</li>)}</ul>
            {Object.keys(report.excluded_facts).length > 0 && <p className="small-note">Facts excluded: {Object.entries(report.excluded_facts).map(([k, v]) => `${label(k)} (${v})`).join(', ')}</p>}
            {report.countercase.map(c => <p className="small-note" key={c}>{c}</p>)}
          </div></Panel>
        </>}
        <Panel title="Original sources and audit" subtitle="Original JSON bytes are kept locally with their SHA-256"><div className="panel-body">
          {detail.sources.map(s => <div className="fact-evidence" key={`${s.attempt}:${s.kind}`}><strong>{s.kind} · attempt {s.attempt} · {s.size_bytes.toLocaleString('en-US')} bytes</strong><p className="small-note">Retrieved {timestamp(s.received_at)}<br/><a href={s.url} target="_blank" rel="noreferrer">Official SEC endpoint</a></p><p className="mono">{s.sha256}</p><button onClick={() => void download(s.kind, s.sha256)}>Download original {s.kind}</button></div>)}
          {!detail.sources.length && <p className="small-note">No original sources stored yet.</p>}
          {detail.events.map((event, i) => <p className="small-note" key={i}>{timestamp(event.at)} · {label(event.action)}{typeof event.detail?.code === 'string' && ` · ${event.detail.code}`}</p>)}
        </div></Panel>
      </>}</div>
    </div>
  </div>;
}

