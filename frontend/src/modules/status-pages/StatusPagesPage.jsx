import { Globe, LayoutGrid, AlertTriangle, Siren, Users, Plus, RefreshCw, Copy, ExternalLink, ChevronDown, X } from "lucide-react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageLoader from "../../components/PageLoader";
import { useNavigate } from "react-router-dom";
import { createStatusPage, fetchMonitors, fetchStatusPages, updateStatusPage } from "../../api";
import { useAuth } from "../../context/AuthContext";

const FORM_DEFAULTS = {
  name: "",
  slug: "",
  heroTitle: "",
  heroDescription: "",
  selectedMonitorIds: [],
  isPublic: true,
};
const DEFERRED_STATUS_MONITOR_LOAD_MS = 1100;

export default function StatusPagesPage() {
  const { user, logout, workspace } = useAuth();
  const navigate = useNavigate();

  const [monitors, setMonitors] = useState([]);
  const [statusPages, setStatusPages] = useState([]);
  const [form, setForm] = useState(FORM_DEFAULTS);
  const [slugTouched, setSlugTouched] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [monitorsLoading, setMonitorsLoading] = useState(false);
  const [monitorPickerOpen, setMonitorPickerOpen] = useState(false);
  const [monitorSearch, setMonitorSearch] = useState("");
  const deferredLoadRef = useRef(null);

  const clearDeferredMonitorLoad = useCallback(() => {
    if (deferredLoadRef.current) {
      clearTimeout(deferredLoadRef.current);
      deferredLoadRef.current = null;
    }
  }, []);

  const loadMonitorsSection = useCallback(async () => {
    if (!user) return;
    setMonitorsLoading(true);
    try {
      const monitorItems = await fetchMonitors(user);
      setMonitors(Array.isArray(monitorItems) ? monitorItems : []);
    } catch {
      // Keep status page list responsive even if monitor metadata loads later.
    } finally {
      setMonitorsLoading(false);
    }
  }, [user]);

  const scheduleMonitorLoad = useCallback(() => {
    clearDeferredMonitorLoad();
    deferredLoadRef.current = setTimeout(() => {
      loadMonitorsSection();
    }, DEFERRED_STATUS_MONITOR_LOAD_MS);
  }, [clearDeferredMonitorLoad, loadMonitorsSection]);

  const loadPage = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!workspace?.id) {
      setLoading(false);
      setRefreshing(false);
      setError("Workspace context is unavailable right now.");
      return;
    }
    clearDeferredMonitorLoad();
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const statusItems = await fetchStatusPages(user, workspace.id);
      setStatusPages(Array.isArray(statusItems) ? statusItems : []);
      scheduleMonitorLoad();
    } catch (err) {
      setError(err?.message || "Could not load status pages.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clearDeferredMonitorLoad, scheduleMonitorLoad, user, workspace?.id]);

  useEffect(() => {
    loadPage();
    return () => {
      clearDeferredMonitorLoad();
    };
  }, [loadPage, clearDeferredMonitorLoad]);

  async function ensureMonitorsLoaded() {
    if (monitors.length > 0 || monitorsLoading) return;
    await loadMonitorsSection();
  }

  const selectedMonitorSet = useMemo(() => new Set(form.selectedMonitorIds), [form.selectedMonitorIds]);
  const pageSummary = useMemo(() => ({
    total: statusPages.length,
    publicCount: statusPages.filter((page) => page.isPublic !== false).length,
    selectedMonitors: statusPages.reduce((sum, page) => sum + (page.selectedMonitorCount || page.selectedMonitorIds?.length || 0), 0),
  }), [statusPages]);

  function resetForm() {
    setForm(FORM_DEFAULTS);
    setEditingId("");
    setSlugTouched(false);
    setMonitorPickerOpen(false);
    setMonitorSearch("");
  }

  async function openNewPage() {
    await ensureMonitorsLoaded();
    resetForm();
  }

  async function openEdit(page) {
    await ensureMonitorsLoaded();
    setEditingId(page.id);
    setForm({
      name: page.name || "",
      slug: page.slug || "",
      heroTitle: page.heroTitle || "",
      heroDescription: page.heroDescription || "",
      selectedMonitorIds: Array.isArray(page.selectedMonitorIds) ? page.selectedMonitorIds : [],
      isPublic: page.isPublic !== false,
    });
    setSlugTouched(true);
    setMonitorPickerOpen(false);
    setMonitorSearch("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateName(value) {
    setForm((prev) => ({
      ...prev,
      name: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
  }

  async function copyPublicUrl(slug) {
    const publicUrl = `${window.location.origin}/status/${slug}`;
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      setError("Could not copy the public URL.");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!workspace?.id) return;

    setSubmitting(true);
    setError("");
    try {
      let savedPage;
      if (editingId) {
        savedPage = await updateStatusPage(user, workspace.id, editingId, form);
        setStatusPages((prev) => prev.map((page) => (page.id === editingId ? savedPage : page)));
      } else {
        savedPage = await createStatusPage(user, workspace.id, form);
        setStatusPages((prev) => [savedPage, ...prev]);
      }
      resetForm();
    } catch (err) {
      setError(err?.message || "Could not save status page.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageLoader />
    );
  }

  return (
    <div className="min-h-screen text-[#f2f2f2]">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Status Page</h1>
            <p className="text-sm text-[#8d94a0] mt-1">Choose which monitors are visible publicly and keep the page simple and trustworthy.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadPage({ silent: true })}
              disabled={refreshing}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {/* <button
              type="button"
              onClick={openNewPage}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Page
            </button> */}
            {/* <button
              type="button"
              onClick={logout}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
            >
              Logout
            </button> */}
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-5 md:px-8 py-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryCard label="Status Pages" value={pageSummary.total} caption="Configured public pages" />
            <SummaryCard label="Public Now" value={pageSummary.publicCount} caption="Currently visible" />
            <SummaryCard label="Linked Monitors" value={pageSummary.selectedMonitors} caption="Published monitor selections" />
            <SummaryCard label="Published Links" value={statusPages.length} caption="Shareable public endpoints" />
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-5">
            <form onSubmit={handleSubmit} className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Public Configuration</p>
                <h2 className="text-lg font-medium text-[#edf2fb] mt-2">
                  {editingId ? "Update status page" : "Create status page"}
                </h2>
              </div>

              <Field label="Page Name">
                <input
                  value={form.name}
                  onChange={(event) => updateName(event.target.value)}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                  placeholder="Production Status"
                  required
                />
              </Field>

              <Field label="Public Slug">
                <input
                  value={form.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setForm((prev) => ({ ...prev, slug: slugify(event.target.value) }));
                  }}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                  placeholder="production-status"
                  required
                />
              </Field>

              <Field label="Hero Title">
                <input
                  value={form.heroTitle}
                  onChange={(event) => setForm((prev) => ({ ...prev, heroTitle: event.target.value }))}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                  placeholder="Current service health"
                />
              </Field>

              <Field label="Hero Description">
                <textarea
                  value={form.heroDescription}
                  onChange={(event) => setForm((prev) => ({ ...prev, heroDescription: event.target.value }))}
                  className="w-full min-h-24 rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-3 text-sm"
                  placeholder="Availability and incident updates for the services below."
                />
              </Field>

              <Field label="Visible Monitors">
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await ensureMonitorsLoaded();
                      setMonitorPickerOpen((prev) => !prev);
                    }}
                    className="w-full min-h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-2.5 text-sm flex items-center justify-between gap-3"
                  >
                    <span className="text-left min-w-0">
                      <span className="block text-[#d7deea]">
                        {form.selectedMonitorIds.length === 0
                          ? "Select monitors to publish"
                          : `${form.selectedMonitorIds.length} monitor${form.selectedMonitorIds.length === 1 ? "" : "s"} selected`}
                      </span>
                      <span className="block text-xs text-[#8d94a0] mt-1">
                        Choose only the services you want on the public page.
                      </span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-[#8d94a0] transition ${monitorPickerOpen ? "rotate-180" : ""}`} />
                  </button>

                  {form.selectedMonitorIds.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {form.selectedMonitorIds.map((monitorId) => {
                        const selectedMonitor = monitors.find((item) => item.id === monitorId);
                        return (
                          <span key={monitorId} className="inline-flex items-center gap-2 rounded-full border border-[#2a2f39] bg-[#12161d] px-3 py-1.5 text-xs text-[#d7deea]">
                            <span className="truncate max-w-[12rem]">{selectedMonitor?.name || monitorId}</span>
                            <button
                              type="button"
                              onClick={() => setForm((prev) => ({
                                ...prev,
                                selectedMonitorIds: prev.selectedMonitorIds.filter((value) => value !== monitorId),
                              }))}
                              className="text-[#8d94a0] hover:text-[#f1f5fb]"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {monitorPickerOpen ? (
                    <div className="rounded-xl border border-[#252a33] bg-[#14181e] p-3 space-y-3">
                      <input
                        type="text"
                        value={monitorSearch}
                        onChange={(event) => setMonitorSearch(event.target.value)}
                        placeholder="Search monitor name or URL"
                        className="w-full h-10 rounded-lg border border-[#252a33] bg-[#10141b] px-3 text-sm"
                      />
                      <div className="max-h-64 overflow-auto space-y-2">
                        {monitorsLoading && monitors.length === 0 ? (
                          <p className="text-sm text-[#8d94a0]">Loading monitors...</p>
                        ) : getFilteredMonitors(monitors, monitorSearch).length === 0 ? (
                          <p className="text-sm text-[#8d94a0]">No monitors match this search.</p>
                        ) : (
                          getFilteredMonitors(monitors, monitorSearch).map((monitor) => (
                            <label key={monitor.id} className="flex items-start gap-3 text-sm text-[#d7deea]">
                              <input
                                type="checkbox"
                                checked={selectedMonitorSet.has(monitor.id)}
                                onChange={(event) => setForm((prev) => ({
                                  ...prev,
                                  selectedMonitorIds: event.target.checked
                                    ? [...new Set([...prev.selectedMonitorIds, monitor.id])]
                                    : prev.selectedMonitorIds.filter((value) => value !== monitor.id),
                                }))}
                              />
                              <span>
                                <span className="block">{monitor.name}</span>
                                <span className="block text-xs text-[#8d94a0] mt-1">{monitor.url}</span>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Field>

              <label className="flex items-center gap-2 text-sm text-[#d7deea]">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(event) => setForm((prev) => ({ ...prev, isPublic: event.target.checked }))}
                />
                Public page is enabled
              </label>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                >
                  Reset
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold disabled:opacity-50"
                >
                  {submitting ? "Saving..." : editingId ? "Save Changes" : "Create Status Page"}
                </button>
              </div>
            </form>

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Published Pages</p>
                  <h2 className="text-lg font-medium text-[#edf2fb] mt-2">Current status pages</h2>
                </div>
                <div className="text-sm text-[#8d94a0]">{statusPages.length} pages</div>
              </div>

              {statusPages.length === 0 ? (
                <EmptyState message="No status page created yet." />
              ) : (
                <div className="space-y-3">
                  {statusPages.map((page) => {
                    const publicUrl = `${window.location.origin}/status/${page.slug}`;
                    return (
                      <article key={page.id} className="rounded-xl border border-[#252a33] bg-[#12161d] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-[#edf2fb]">{page.name}</p>
                            <p className="text-xs text-[#8d94a0] mt-1">/{page.slug}</p>
                          </div>
                          <span className={`text-[11px] px-2 py-1 rounded-full ${page.isPublic ? "bg-[#123828] text-[#69e7ba]" : "bg-[#402025] text-[#f6b5a8]"}`}>
                            {page.isPublic ? "Public" : "Hidden"}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <MiniStat label="Visible monitors" value={String(page.selectedMonitorIds?.length || 0)} />
                          <MiniStat label="Updated" value={formatTimestamp(page.updatedAt)} />
                        </div>
                        <div className="rounded-lg border border-[#252a33] bg-[#0f1319] px-3 py-2 text-xs text-[#9ba6b6] break-all">
                          {publicUrl}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}
                            className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                          >
                            <span className="inline-flex items-center gap-2">
                              <ExternalLink className="w-3.5 h-3.5" />
                              Open
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => copyPublicUrl(page.slug)}
                            className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                          >
                            <span className="inline-flex items-center gap-2">
                              <Copy className="w-3.5 h-3.5" />
                              Copy Link
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(page)}
                            className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                          >
                            Edit
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </section>

        </div>
    </div>
  );
}

function SidebarItem({ Icon: IconComponent, label, active = false, onClick }) {
  const iconNode = IconComponent ? createElement(IconComponent, { className: "w-4 h-4" }) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${
        active ? "bg-[#181c24] text-[#eff3fa]" : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      {iconNode}
      <span>{label}</span>
    </button>
  );
}

function SummaryCard({ label, value, caption, compact = false }) {
  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <p className={`mt-2 font-semibold text-[#edf3fb] ${compact ? "text-lg truncate" : "text-2xl"}`}>{value}</p>
      <p className="text-sm text-[#7a828f] mt-0.5">{caption}</p>
    </article>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2b313c] bg-[#11151c] py-10 px-4 text-center text-sm text-[#7f8793]">
      {message}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="text-sm text-[#dbe2ee] mt-2">{value}</p>
    </div>
  );
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getFilteredMonitors(monitors, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return monitors;
  return monitors.filter((monitor) => {
    const name = String(monitor?.name || "").toLowerCase();
    const url = String(monitor?.url || "").toLowerCase();
    return name.includes(normalized) || url.includes(normalized);
  });
}
