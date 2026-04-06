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

export function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-base border-b-2 transition ${
        active
          ? "border-[#d3d6dc] text-[#edf1f8]"
          : "border-transparent text-[#8d94a0] hover:text-[#d3dbe7]"
      }`}
    >
      {children}
    </button>
  );
}

export function MetricCard({ label, value, accent = "text-[#edf3fb]", compact = false }) {
  return (
    <article className={`bg-[#0f1217] border border-[#22252b] rounded-xl ${compact ? "p-3" : "p-3"}`}>
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <p className={`${compact ? "text-xl" : "text-2xl"} font-semibold mt-1.5 ${accent}`}>{value}</p>
    </article>
  );
}

export function SurfaceStat({ label, value }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.1em] text-[#7f8793]">{label}</p>
      <p className="text-sm text-[#e3e9f4] mt-1">{value}</p>
    </div>
  );
}

export function ActionButton({ children, onClick, disabled = false, tone = "default", icon: IconComponent }) {
  const toneClass =
    tone === "primary"
      ? "border-[#d3d6dc] bg-[#d3d6dc] text-[#111317]"
      : "border-[#2a2f39] bg-[#14181e] text-[#d4dae4]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-9 px-3 rounded-lg border text-sm inline-flex items-center gap-2 disabled:opacity-50 ${toneClass}`}
    >
      {IconComponent ? <IconComponent className="w-3.5 h-3.5" /> : null}
      {children}
    </button>
  );
}

export function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#1f232b] pb-2 last:border-b-0 last:pb-0">
      <span className="text-[#9ca3af]">{label}</span>
      <span className="text-right text-[#dbe2ee] break-all">{value}</span>
    </div>
  );
}
