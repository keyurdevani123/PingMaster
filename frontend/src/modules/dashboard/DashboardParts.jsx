import { useState } from "react";
import { Plus, Server, Trash2, AlertTriangle } from "lucide-react";
import { formatRelativeTime, getStatusMeta } from "./dashboardUtils";

// ── Nav item ──────────────────────────────────────────────────────────────────
export function NavItem({ Icon, label, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${
        active
          ? "bg-[#181c24] text-[#eff3fa]"
          : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

// ── KPI skeleton shimmer block ────────────────────────────────────────────────
function KpiSkeleton({ label, caption }) {
  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <div className="mt-1.5 min-h-[32px] flex items-center">
        <span
          className="loading-metric-block h-[22px] w-[64px] rounded-md"
          aria-label={`${label} loading`}
        />
      </div>
      <p className="text-sm text-[#7a828f] mt-0.5">{caption}</p>
    </article>
  );
}

// ── KPI card (resolved value) ─────────────────────────────────────────────────
function KpiCard({ label, value, caption, valueColor }) {
  const isLoading = value === "--";
  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <div className="mt-1.5 min-h-[32px] flex items-center">
        {isLoading ? (
          <span
            className="loading-metric-block h-[22px] w-[64px] rounded-md"
            aria-label={`${label} loading`}
          />
        ) : (
          <p className={`text-2xl font-semibold ${valueColor}`}>{value}</p>
        )}
      </div>
      <p className="text-sm text-[#7a828f] mt-0.5">{caption}</p>
    </article>
  );
}

// ── KPI row — each card resolves independently ────────────────────────────────
export function KpiRow({ kpis, loading }) {
  return (
    <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
      {kpis.map((item) =>
        loading && item.value === "--" ? (
          <KpiSkeleton key={item.label} label={item.label} caption={item.caption} />
        ) : (
          <KpiCard key={item.label} {...item} />
        )
      )}
    </section>
  );
}

// ── Latency tooltip ───────────────────────────────────────────────────────────
export function LatencyTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-lg border border-[#2a2f39] bg-[#131821] px-3 py-2 shadow-xl">
      <p className="text-sm font-medium text-[#edf2fb]">{item.name}</p>
      <p className="text-xs text-[#8d94a0] mt-1">Average response time</p>
      <p className="text-sm text-[#8fdfff] mt-1">{item.avgLatency} ms</p>
    </div>
  );
}

// ── Delete confirm overlay (replaces window.confirm) ─────────────────────────
export function DeleteConfirmCard({ monitorName, onConfirm, onCancel }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#0d0f13]/95 backdrop-blur-[2px] border border-[#5c2a30] px-4 py-3 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col items-center gap-3 text-center w-full max-w-xs">
        <div className="w-10 h-10 rounded-full bg-[#2a1218] border border-[#5c2a30] flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-[#f0a496]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#edf2fb]">Delete monitor?</p>
          <p className="text-xs text-[#8d94a0] mt-1 truncate max-w-[220px]">
            <span className="text-[#c9d1dd]">{monitorName}</span> will be permanently removed.
          </p>
        </div>
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-8 rounded-md border border-[#2a2f39] bg-[#14181e] text-[#c9d1dd] text-sm hover:bg-[#1a2030] transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-8 rounded-md bg-[#7c2020] hover:bg-[#9a2828] text-[#fde8e8] text-sm font-semibold transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Monitor list-row shimmer (shown while first page loads) ───────────────────
export function InfraRowSkeleton() {
  return (
    <div className="rounded-lg border border-[#262b34] bg-[#12161d] p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full loading-metric-block" />
          <span className="loading-metric-block h-4 w-40 rounded-md" />
          <span className="loading-metric-block h-5 w-20 rounded-full" />
        </div>
        <span className="loading-metric-block h-3 w-56 rounded-md" />
        <span className="loading-metric-block h-3 w-36 rounded-md" />
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right space-y-1">
          <span className="loading-metric-block h-3 w-16 rounded-md block" />
          <span className="loading-metric-block h-5 w-12 rounded-md block" />
        </div>
        <div className="text-right space-y-1">
          <span className="loading-metric-block h-3 w-20 rounded-md block" />
          <span className="loading-metric-block h-5 w-12 rounded-md block" />
        </div>
        <span className="loading-metric-block h-9 w-14 rounded-md" />
        <span className="loading-metric-block h-9 w-9 rounded-md" />
      </div>
    </div>
  );
}

// ── Monitor infra row ─────────────────────────────────────────────────────────
export function InfraRow({ monitor, stats, onOpen, onPing, onDelete, isBusy }) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const status = getStatusMeta(monitor.status);
  const uptimeValue = stats?.uptime24h ?? "--";
  const responseValue = monitor.lastLatency != null ? `${monitor.lastLatency} ms` : "n/a";
  const statusCode = monitor.lastStatusCode ?? "n/a";

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onOpen();
        }}
        className={`rounded-lg border border-[#262b34] bg-[#12161d] p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 cursor-pointer ${
          isBusy || pendingDelete
            ? "opacity-70 pointer-events-none"
            : "hover:bg-[#161b23] transition"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${status.dotClass}`} />
            <p className="font-medium text-base text-[#edf2fb] truncate">{monitor.name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${status.badgeClass}`}>
              {status.label}
            </span>
          </div>
          <p className="text-sm text-[#8d94a0] truncate mt-1">{monitor.url}</p>
          <p className="text-xs text-[#6f7785] mt-1">
            Last checked {formatRelativeTime(monitor.lastChecked)} | 24h uptime{" "}
            {stats?.uptime24h != null ? `${stats.uptime24h}%` : "--"}
          </p>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <div className="text-right mr-1">
            <p className="text-sm uppercase tracking-[0.08em] text-[#6f7785]">Response</p>
            <p className="text-lg font-medium text-[#d8dee9]">{responseValue}</p>
          </div>
          <div className="text-right mr-1">
            <p className="text-sm uppercase tracking-[0.08em] text-[#6f7785]">Status Code</p>
            <p className="text-lg font-medium text-[#d8dee9]">{statusCode}</p>
          </div>
          <div className="text-right mr-1 hidden lg:block">
            <p className="text-sm uppercase tracking-[0.08em] text-[#6f7785]">24h Uptime</p>
            <p className="text-lg font-medium text-[#d8dee9]">
              {uptimeValue !== "--" ? `${uptimeValue}%` : "--"}
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPing(monitor.id);
            }}
            className="h-9 px-3 rounded-md border border-[#2b313c] text-[#ced5e0] text-base hover:bg-[#171c25] transition"
          >
            {isBusy ? "Pinging…" : "Ping"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete(true);
            }}
            className="h-9 w-9 rounded-md border border-[#2b313c] grid place-items-center text-[#ef9f90] hover:bg-[#21171a] transition"
            title="Delete monitor"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {pendingDelete && (
        <DeleteConfirmCard
          monitorName={monitor.name}
          onConfirm={() => {
            setPendingDelete(false);
            onDelete(monitor.id);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ onAdd }) {
  return (
    <div className="text-center py-14 border border-dashed border-[#313642] rounded-xl bg-[#11151c]">
      <Server className="w-8 h-8 text-[#6f7785] mx-auto mb-3" />
      <h3 className="text-[#e8edf5] font-semibold text-base mb-1">No monitors found</h3>
      <p className="text-[#8d94a0] text-sm mb-4">
        Add your first monitor to start collecting uptime and latency trends.
      </p>
      {typeof onAdd === "function" ? (
        <button
          onClick={onAdd}
          className="bg-[#d3d6dc] hover:opacity-90 text-[#101317] font-semibold px-4 py-2 rounded-lg text-sm transition inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Monitor
        </button>
      ) : null}
    </div>
  );
}
