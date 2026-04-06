export function SummaryCard(props) {
  const IconComponent = props.icon;
  const { label, value } = props;

  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <div className="flex items-center gap-2 text-[#8d94a0]">
        <IconComponent className="w-4 h-4" />
        <p className="text-sm uppercase tracking-[0.09em]">{label}</p>
      </div>
      <p className="text-2xl font-semibold mt-2 text-[#edf3fb]">{value}</p>
    </article>
  );
}
