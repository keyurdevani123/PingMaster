import { Plus, Server, Trash2 } from "lucide-react";
import { formatRelativeTime, getStatusMeta } from "./dashboardUtils";

export function NavItem(props) {
  const IconComponent = props.Icon;
  const { label, active = false, onClick } = props;

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
      <IconComponent className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

export function KpiRow({ kpis }) {
  return (
    <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
      {kpis.map((item) => (
        <article key={item.label} className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
          <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{item.label}</p>
          <div className="mt-1.5 min-h-[32px] flex items-center">
            {item.value === "--" ? (
              <span
                className="loading-metric-block h-[18px] w-[68px] rounded-md"
                aria-label={`${item.label} loading`}
              />
            ) : (
              <p className={`text-2xl font-semibold ${item.valueColor}`}>{item.value}</p>
            )}
          </div>
          <p className="text-sm text-[#7a828f] mt-0.5">{item.caption}</p>
        </article>
      ))}
    </section>
  );
}

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

export function InfraRow({ monitor, stats, onOpen, onPing, onDelete, isBusy }) {
  const status = getStatusMeta(monitor.status);
  const uptimeValue = stats?.uptime24h ?? "--";
  const responseValue = monitor.lastLatency != null ? `${monitor.lastLatency} ms` : "n/a";
  const statusCode = monitor.lastStatusCode ?? "n/a";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      className={`rounded-lg border border-[#262b34] bg-[#12161d] p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 cursor-pointer ${isBusy ? "opacity-70 pointer-events-none" : "hover:bg-[#161b23] transition"}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status.dotClass}`} />
          <p className="font-medium text-base text-[#edf2fb] truncate">{monitor.name}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full ${status.badgeClass}`}>{status.label}</span>
        </div>
        <p className="text-sm text-[#8d94a0] truncate mt-1">{monitor.url}</p>
        <p className="text-xs text-[#6f7785] mt-1">
          Last checked {formatRelativeTime(monitor.lastChecked)} | 24h uptime {stats?.uptime24h ?? "--"}%
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
          <p className="text-lg font-medium text-[#d8dee9]">{uptimeValue}%</p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPing(monitor.id);
          }}
          className="h-9 px-3 rounded-md border border-[#2b313c] text-[#ced5e0] text-base hover:bg-[#171c25] transition"
        >
          {isBusy ? "Pinging..." : "Ping"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(monitor.id);
          }}
          className="h-9 w-9 rounded-md border border-[#2b313c] grid place-items-center text-[#ef9f90] hover:bg-[#21171a] transition"
          title="Delete monitor"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ onAdd }) {
  return (
    <div className="text-center py-14 border border-dashed border-[#313642] rounded-xl bg-[#11151c]">
      <Server className="w-8 h-8 text-[#6f7785] mx-auto mb-3" />
      <h3 className="text-[#e8edf5] font-semibold text-base mb-1">No monitors found</h3>
      <p className="text-[#8d94a0] text-sm mb-4">
        Add your first monitor to start collecting uptime and latency trends.
      </p>
      <button
        onClick={onAdd}
        className="bg-[#d3d6dc] hover:opacity-90 text-[#101317] font-semibold px-4 py-2 rounded-lg text-sm transition inline-flex items-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Add Monitor
      </button>
    </div>
  );
}
