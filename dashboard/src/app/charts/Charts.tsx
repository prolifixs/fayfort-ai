/** A small chart kit for Control Center (revenue, hours, ratings). SVG, no library.
 *
 * Built to the data-viz method: thin marks (<=24px columns, 2px lines), a 2px surface gap between stacked segments,
 * recessive hairline grid, a legend whenever there are two or more series, hover AND keyboard tooltips, and a table
 * view for every chart (some light-mode series colours are below 3:1 on white, so the table is the relief).
 * Series colours come from --series-N in charts.css, validated for both themes; they follow the entity, never rank.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import "./charts.css";

export type Series = { key: string; label: string };
type Fmt = (value: number) => string;

export const compact = (value: number) =>
  Math.abs(value) >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M` : Math.abs(value) >= 1000 ? `${+(value / 1000).toFixed(1)}K` : `${Math.round(value)}`;

/** The element's real width, so text and marks are drawn at true size instead of being stretched. */
function useWidth(ref: RefObject<HTMLElement | null>, fallback = 640) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width) || fallback));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value / 4) || 10;
  return Math.ceil(value / (step * power)) * step * power;
}

/** Frame: title, legend, the chart, and a "Show as table" switch. */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  legend?: Series[];
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={`viz viz-frame ${className}`.trim()} aria-label={title}>
      <figcaption className="viz-head">
        <div>
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <button type="button" className="viz-switch" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </figcaption>
      {legend && legend.length > 1 && !asTable && (
        <ul className="viz-legend" aria-label="Legend">
          {legend.map((item, index) => (
            <li key={item.key}>
              <i className={`viz-swatch s${index + 1}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {asTable ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; index?: number }[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <small>{tip.title}</small>
      {tip.rows.map((row) => (
        <div key={row.label}>
          {row.index !== undefined && <i className={`viz-key s${row.index + 1}`} aria-hidden="true" />}
          <b>{row.value}</b>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Columns over time, stacked by series. Each column is a hover/focus target with every series in the tooltip. */
export function StackedColumns({
  data,
  series,
  format,
  height = 240,
  label,
}: {
  data: { label: string; values: Record<string, number> }[];
  series: Series[];
  format: Fmt;
  height?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [active, setActive] = useState<number | null>(null);
  const width = useWidth(box);
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const totals = data.map((d) => series.reduce((sum, s) => sum + Math.max(0, d.values[s.key] || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 70))));
  function show(index: number, clientX?: number) {
    const rect = box.current?.getBoundingClientRect();
    const svgX = pad.left + band * index + band / 2;
    const x = rect ? (clientX !== undefined ? clientX - rect.left : (svgX / width) * rect.width) : svgX;
    setActive(index);
    setTip({
      x,
      y: 8,
      title: data[index].label,
      rows: [
        { label: "Total", value: format(totals[index]) },
        ...series.map((s, i) => ({ label: s.label, value: format(data[index].values[s.key] || 0), index: i })).filter((row, i) => (data[index].values[series[i].key] || 0) !== 0),
      ],
    });
  }
  return (
    <div className="viz-plot" ref={box} onPointerLeave={() => (setTip(null), setActive(null))}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="viz-tick" x={pad.left - 6} y={y(tick) + 4} textAnchor="end">
              {compact(tick)}
            </text>
          </g>
        ))}
        {data.map((d, index) => {
          const x = pad.left + band * index + (band - barW) / 2;
          let base = 0;
          const parts = series
            .map((s, i) => ({ s, i, value: Math.max(0, d.values[s.key] || 0) }))
            .filter((part) => part.value > 0);
          return (
            <g
              key={d.label}
              className={active === index ? "viz-col is-active" : "viz-col"}
              tabIndex={0}
              role="button"
              aria-label={`${d.label}: ${format(totals[index])}`}
              onPointerMove={(event) => show(index, event.clientX)}
              onFocus={() => show(index)}
              onBlur={() => (setTip(null), setActive(null))}
            >
              <rect className="viz-hit" x={pad.left + band * index} y={pad.top} width={band} height={plotH} />
              {parts.map((part, partIndex) => {
                const top = y(base + part.value);
                const bottom = y(base);
                base += part.value;
                const gap = partIndex > 0 ? 2 : 0;
                const h = Math.max(0, bottom - top - gap);
                const last = partIndex === parts.length - 1;
                return last ? (
                  <path key={part.s.key} className={`viz-fill s${part.i + 1}`} d={roundedTop(x, top, barW, h, Math.min(4, h, barW / 2))} />
                ) : (
                  <rect key={part.s.key} className={`viz-fill s${part.i + 1}`} x={x} y={top} width={barW} height={h} />
                );
              })}
            </g>
          );
        })}
        <line className="viz-axis" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        {data.map((d, index) =>
          index % every === 0 ? (
            <text key={d.label} className="viz-tick" x={pad.left + band * index + band / 2} y={height - 8} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Horizontal bars, one series: value at the tip. */
export function HBars({ data, format, label, seriesIndex = 0 }: { data: { label: string; value: number; note?: string }[]; format: Fmt; label: string; seriesIndex?: number }) {
  const max = Math.max(0, ...data.map((d) => d.value)) || 1;
  return (
    <ul className="viz-hbars" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${format(d.value)}`}>
          <span className="viz-hbar-label">
            {d.label}
            {d.note && <small>{d.note}</small>}
          </span>
          <span className="viz-hbar-track">
            <i className={`viz-hbar s${seriesIndex + 1}`} style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%` }} />
            <b>{format(d.value)}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A single line over time with a soft wash, end label and a crosshair tooltip. */
export function TrendLine({
  points,
  format,
  min,
  max,
  label,
  height = 180,
}: {
  points: { label: string; value: number | null }[];
  format: Fmt;
  min?: number;
  max?: number;
  label: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = useWidth(box);
  const pad = { top: 14, right: 40, bottom: 26, left: 36 };
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const lo = min ?? Math.min(0, ...values);
  const hi = max ?? niceMax(Math.max(...values, 1));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points.length <= 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const y = (v: number) => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const drawn = points.map((p, i) => (p.value === null ? null : [x(i), y(p.value)] as [number, number]));
  const path = drawn.reduce((acc, point, i) => (point ? `${acc}${acc && drawn[i - 1] ? "L" : "M"}${point[0]},${point[1]}` : acc), "");
  const lastIndex = drawn.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop();
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 70))));
  function pick(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - svgX) < Math.abs(x(best) - svgX)) best = i;
    });
    setHover(best);
  }
  const hoverPoint = hover !== null ? points[hover] : null;
  return (
    <div className="viz-plot" ref={box} onPointerMove={(event) => pick(event.clientX)} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="viz-wash-stop" stopOpacity="0.14" />
            <stop offset="1" className="viz-wash-stop" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text className="viz-tick" x={pad.left - 6} y={y(tick) + 4} textAnchor="end">
              {format(tick)}
            </text>
          </g>
        ))}
        {path && lastIndex !== undefined && (
          <path d={`${path}L${drawn[lastIndex]![0]},${y(lo)}L${drawn.find(Boolean)![0]},${y(lo)}Z`} fill={`url(#${gradient})`} />
        )}
        <path className="viz-line s1" d={path} />
        {hover !== null && <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} />}
        {drawn.map((point, i) =>
          point && (i === lastIndex || i === hover) ? <circle key={i} className="viz-dot s1" cx={point[0]} cy={point[1]} r={4.5} /> : null,
        )}
        {lastIndex !== undefined && points[lastIndex].value !== null && (
          <text className="viz-end-label" x={drawn[lastIndex]![0] + 8} y={drawn[lastIndex]![1] + 4}>
            {format(points[lastIndex].value as number)}
          </text>
        )}
        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={p.label} className="viz-tick" x={x(i)} y={height - 8} textAnchor="middle">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      {hoverPoint && (
        <Tooltip
          tip={{
            x: ((x(hover as number) / width) * (box.current?.getBoundingClientRect().width || width)),
            y: 8,
            title: hoverPoint.label,
            rows: [{ label, value: hoverPoint.value === null ? "No data" : format(hoverPoint.value) }],
          }}
        />
      )}
    </div>
  );
}

/** A grid of cells on a one-hue scale (0 = nothing). Each cell is a hover/focus target. */
export function Heatmap({
  rows,
  columns,
  value,
  format,
  label,
}: {
  rows: string[];
  columns: string[];
  value: (row: number, column: number) => number | null;
  format: (value: number | null) => string;
  label: string;
}) {
  const [tip, setTip] = useState<string>("");
  const steps = useMemo(() => [0, 0.2, 0.4, 0.6, 0.8, 1], []);
  const step = (v: number) => steps.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 0);
  return (
    <div className="viz-heat" aria-label={label}>
      <table>
        <thead>
          <tr>
            <td />
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {columns.map((column, c) => {
                const v = value(r, c);
                const text = `${row} ${column}: ${format(v)}`;
                return (
                  <td key={column}>
                    <span
                      className={v === null ? "viz-cell is-none" : `viz-cell q${Math.round(step(v) * 10)}`}
                      tabIndex={0}
                      aria-label={text}
                      title={text}
                      onPointerEnter={() => setTip(text)}
                      onFocus={() => setTip(text)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="viz-heat-foot">
        <span className="viz-heat-scale" aria-hidden="true">
          <small>None</small>
          {steps.map((s) => (
            <i key={s} className={`viz-cell q${Math.round(s * 10)}`} />
          ))}
          <small>Full</small>
        </span>
        <span className="viz-heat-readout" role="status">
          {tip}
        </span>
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub, delta, tone }: { label: string; value: string; sub?: string; delta?: number | null; tone?: "good" | "bad" }) {
  return (
    <div className="viz-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {delta !== undefined && delta !== null ? (
        <small className={delta >= 0 ? "is-up" : "is-down"}>
          <i aria-hidden="true">{delta >= 0 ? "▲" : "▼"}</i> {Math.abs(Math.round(delta * 100))}% {sub || ""}
        </small>
      ) : (
        sub && <small className={tone ? `is-${tone}` : ""}>{sub}</small>
      )}
    </div>
  );
}

export function Stars({ value, label }: { value: number | null; label?: string }) {
  const v = value ?? 0;
  return (
    <span className="viz-stars" role="img" aria-label={label || `${v.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} style={{ ["--fill" as string]: `${Math.max(0, Math.min(1, v - n + 1)) * 100}%` }} aria-hidden="true">
          ★
        </i>
      ))}
    </span>
  );
}
