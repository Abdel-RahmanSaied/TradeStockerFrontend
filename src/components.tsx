import { useEffect, useRef, type ReactNode } from 'react';
export function Badge({children, tone = 'gray'}: {children: ReactNode; tone?: 'gray'|'amber'|'green'}) {return <span className={`pill ${tone === 'green' ? '' : tone}`}>{children}</span>}
export function Panel({title, subtitle, aside, children}: {title: string; subtitle?: string; aside?: ReactNode; children: ReactNode}) {return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{aside}</div>{children}</section>}
export function Empty({title, children}: {title: string; children: ReactNode}) {return <div className="empty"><strong>{title}</strong>{children}</div>}
export function Metric({label, value, note, mark}: {label: string; value: ReactNode; note: ReactNode; mark: ReactNode}) {return <section className="metric"><div className="metric-label">{label}<span className="muted">{mark}</span></div><div className="metric-value">{value}</div><div className="metric-foot">{note}</div></section>}
export function Modal({title, children, close, error}: {title: string; children: ReactNode; close: () => void; error?: string}) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    dialog.querySelector<HTMLElement>('input, select, button')?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose.current();
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    }
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('keydown', key); previous?.focus();};
  }, []);
  return <div className="dialog-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) close();}}><div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">{title}</h2>{error&&<div className="notice error" role="alert">{error}</div>}{children}</div></div>;
}
