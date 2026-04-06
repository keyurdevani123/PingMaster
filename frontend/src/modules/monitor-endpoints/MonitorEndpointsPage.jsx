import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, RefreshCw, Search, CheckSquare, Square, Network, Layers3, Radar } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  fetchEndpointSuggestions,
  fetchMonitorWorkspace,
  primeEndpointSuggestions,
  updateMonitorEndpoints,
} from "../../api";
import { SummaryCard } from "./MonitorEndpointsParts";
import { normalizeEndpointCandidate } from "./endpointUtils";

export default function MonitorEndpointsPage() {
  const { monitorId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [monitor, setMonitor] = useState(null);
  const [childMonitors, setChildMonitors] = useState([]);
  const [allEndpoints, setAllEndpoints] = useState([]);
  const [selectedEndpoints, setSelectedEndpoints] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const loadData = useCallback(async () => {
    if (!user || !monitorId) return;
    setLoading(true);
    setError("");
    try {
      const payload = await fetchMonitorWorkspace(user, monitorId, { historyLimit: 96, includeChildren: true });
      const found = payload?.monitor;
      if (!found) {
        setError("Monitor not found.");
        setMonitor(null);
        setChildMonitors([]);
        setAllEndpoints([]);
        setSelectedEndpoints(new Set());
        return;
      }

      const children = Array.isArray(payload.childMonitors) ? payload.childMonitors : [];
      const merged = await fetchEndpointSuggestions(user, found, {
        seedUrls: children.map((child) => child.url).filter(Boolean),
      });

      setMonitor(found);
      setChildMonitors(children);
      setAllEndpoints(merged);
      setSelectedEndpoints(new Set(found.endpoints?.length ? found.endpoints : [found.url]));
    } catch (err) {
      setError(err?.message || "Could not load endpoint manager.");
    } finally {
      setLoading(false);
    }
  }, [monitorId, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefreshSuggestions() {
    if (!monitor) return;
    setCrawling(true);
    setError("");
    try {
      const merged = await fetchEndpointSuggestions(user, monitor, {
        force: true,
        seedUrls: childMonitors.map((child) => child.url).filter(Boolean),
      });
      setAllEndpoints(merged);
    } catch {
      setError("Could not refresh endpoint suggestions.");
    } finally {
      setCrawling(false);
    }
  }

  async function handleSave() {
    if (!monitor) return;
    setSaving(true);
    setError("");
    try {
      const endpoints = Array.from(selectedEndpoints);
      const result = await updateMonitorEndpoints(user, monitor.id, endpoints);
      const nextMonitor = result?.monitor ? { ...monitor, ...result.monitor } : { ...monitor, endpoints };
      const merged = Array.from(new Set([nextMonitor.url, ...endpoints, ...allEndpoints]));

      setMonitor(nextMonitor);
      setAllEndpoints(merged);
      primeEndpointSuggestions(user, monitor.id, merged);
      navigate(`/monitors/${monitor.id}`, { replace: true });
    } catch {
      setError("Could not save endpoints.");
    } finally {
      setSaving(false);
    }
  }

  function toggleEndpoint(endpoint) {
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) next.delete(endpoint);
      else next.add(endpoint);
      return next;
    });
  }

  function addEndpointFromInput() {
    const value = normalizeEndpointCandidate(query);
    if (!value) {
      if (query.trim().length > 0) {
        setError("Enter a valid endpoint URL (http or https).");
      }
      return;
    }

    setError("");
    setAllEndpoints((prev) => Array.from(new Set([...prev, value])));
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      next.add(value);
      return next;
    });
    setQuery("");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEndpoints;
    return allEndpoints.filter((endpoint) => endpoint.toLowerCase().includes(q));
  }, [allEndpoints, query]);

  const selectedList = useMemo(() => Array.from(selectedEndpoints), [selectedEndpoints]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <p className="text-[#8d94a0]">Loading endpoint manager...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <main className="max-w-7xl mx-auto px-5 md:px-8 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Endpoint Coverage</h1>
            <p className="text-sm text-[#8d94a0] mt-0.5">{monitor?.name}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshSuggestions}
              disabled={crawling}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${crawling ? "animate-spin" : ""}`} />
              {crawling ? "Refreshing..." : "Refresh Discovery"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Endpoints"}
            </button>
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-sm">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon={Network} label="Tracked" value={`${monitor?.endpoints?.length || 1}`} />
          <SummaryCard icon={Radar} label="Discovered" value={`${allEndpoints.length}`} />
          <SummaryCard icon={CheckSquare} label="Selected" value={`${selectedEndpoints.size}`} />
          <SummaryCard icon={Layers3} label="Child Monitors" value={`${childMonitors.length}`} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_380px] gap-5">
          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium">Discover and Select Endpoints</h2>
              <p className="text-sm text-[#8d94a0] mt-1">Search discovered URLs or add a new route manually, then keep the endpoints you want attached to this monitor.</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#14181e] border border-[#252a33] rounded-lg px-3 h-10 flex-1">
                <Search className="w-4 h-4 text-[#6f7785]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEndpointFromInput();
                    }
                  }}
                  placeholder="Search suggestions or add endpoint URL"
                  className="w-full bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] px-2 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={addEndpointFromInput}
                className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
              >
                Add
              </button>
            </div>

            <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-2.5 text-sm text-[#8d94a0] flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Selected: {selectedEndpoints.size}</span>
              <span>Discovered: {allEndpoints.length}</span>
              <span>Child Monitors: {childMonitors.length}</span>
            </div>

            <div className="space-y-2 max-h-[62vh] overflow-auto pr-1">
              {filtered.map((endpoint) => {
                const checked = selectedEndpoints.has(endpoint);
                return (
                  <button
                    key={endpoint}
                    type="button"
                    onClick={() => toggleEndpoint(endpoint)}
                    className={`w-full text-left rounded-lg border p-3 flex items-center gap-3 transition ${
                      checked
                        ? "border-[#315244] bg-[#132119]"
                        : "border-[#2a2f39] bg-[#12161d] hover:bg-[#171c25]"
                    }`}
                  >
                    {checked ? <CheckSquare className="w-4 h-4 text-[#35cf99]" /> : <Square className="w-4 h-4 text-[#8892a0]" />}
                    <span className="text-sm text-[#dbe2ee] break-all">{endpoint}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed border-[#2a2f39] bg-[#11151c] px-4 py-8 text-center text-sm text-[#8d94a0]">
                  No endpoints found for the current filter.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
              <h2 className="text-sm font-medium">Selected Endpoints</h2>
              <p className="text-sm text-[#8d94a0] mt-1">These URLs will stay attached to this monitor after you save.</p>
              <div className="space-y-2 mt-4 max-h-[28vh] overflow-auto pr-1">
                {selectedList.length === 0 ? (
                  <p className="text-sm text-[#8d94a0]">No endpoints selected yet.</p>
                ) : (
                  selectedList.map((endpoint) => (
                    <div key={endpoint} className="rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-2 text-sm text-[#dbe2ee] break-all">
                      {endpoint}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
              <h2 className="text-sm font-medium">Child Monitors</h2>
              <p className="text-sm text-[#8d94a0] mt-1">Endpoints already promoted into independent monitor pages.</p>
              <div className="space-y-2 mt-4 max-h-[32vh] overflow-auto pr-1">
                {childMonitors.length === 0 ? (
                  <p className="text-sm text-[#8d94a0]">No child monitors yet.</p>
                ) : (
                  childMonitors.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => navigate(`/monitors/${child.id}`, { state: { parentId: monitor?.id } })}
                      className="w-full text-left rounded-lg border border-[#2a2f39] bg-[#12161d] p-3 hover:bg-[#171c25] transition"
                    >
                      <p className="text-sm font-medium text-[#edf2fb] truncate">{child.name}</p>
                      <p className="text-xs text-[#8d94a0] mt-1 truncate">{child.url}</p>
                      <p className="text-xs text-[#6f7785] mt-2">
                        {child.lastLatency != null ? `${child.lastLatency} ms` : "--"} | {child.lastStatusCode ?? "--"}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
