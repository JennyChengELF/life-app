export function ProgressRing({ total, goal }: { total: number; goal: number }) {
  const pct = goal > 0 ? total / goal : 0;
  const r = 70;
  const c = 2 * Math.PI * r;
  const shown = Math.min(pct, 1);
  return (
    <div className="ring">
      <svg viewBox="0 0 180 180" role="img" aria-label={`已喝 ${total} / ${goal} ml`}>
        <circle cx="90" cy="90" r={r} className="ring-bg" />
        <circle
          cx="90"
          cy="90"
          r={r}
          className={`ring-fg ${pct >= 1 ? 'done' : ''}`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform="rotate(-90 90 90)"
        />
      </svg>
      <div className="ring-text">
        <div className="ring-total">{total.toLocaleString()}</div>
        <div className="ring-goal">/ {goal.toLocaleString()} ml</div>
        <div className="ring-pct">{Math.round(pct * 100)}%</div>
      </div>
    </div>
  );
}
