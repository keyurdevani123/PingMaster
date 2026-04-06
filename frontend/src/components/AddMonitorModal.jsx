import { useState } from "react";
import { X } from "lucide-react";

// Simple add-monitor modal: name + URL → calls onAdd({ name, url })
export default function AddMonitorModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const trimmedUrl = url.trim();
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("URL must start with https:// or http://");
      return;
    }
    try {
      new URL(trimmedUrl);
    } catch {
      setError("Please enter a valid URL (e.g. https://example.com)");
      return;
    }

    setSubmitting(true);
    try {
      await onAdd({ name: name.trim(), url: trimmedUrl });
      onClose();
    } catch (err) {
      const message = err?.message || "Could not add monitor.";
      setError(message);
      window.alert(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-[2px] flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[#2a2f39] bg-[#11161d] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[#eef3fa] font-semibold text-xl tracking-tight">Add Monitor</h2>
            <p className="text-sm text-[#8d94a0] mt-1">Track uptime and latency for websites and endpoints.</p>
          </div>
          <button onClick={onClose} className="text-[#7a828f] hover:text-[#e7ecf5] transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base text-[#c9d1dd] mb-1.5">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              placeholder='e.g. "My Portfolio"'
              autoFocus
              className="w-full bg-[#151b24] border border-[#2a3140] text-[#eef3fa] rounded-lg px-4 py-3 text-base focus:outline-none focus:border-[#36cf9b] transition"
            />
          </div>

          <div>
            <label className="block text-base text-[#c9d1dd] mb-1.5">URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://example.com"
              className="w-full bg-[#151b24] border border-[#2a3140] text-[#eef3fa] rounded-lg px-4 py-3 text-base focus:outline-none focus:border-[#36cf9b] transition"
            />
            <p className="text-[#707987] text-sm mt-1.5">
              Must include https:// or http://. PSI audits appear automatically only for page-style websites.
            </p>
          </div>

          {error && <p className="text-[#f0a496] text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 bg-[#161c25] border border-[#2a3140] hover:bg-[#1a212d] text-[#e1e7f2] rounded-lg text-base transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 h-11 bg-[#d3d6dc] hover:opacity-90 text-[#121417] font-semibold rounded-lg text-base transition"
            >
              {submitting ? "Validating..." : "Add Monitor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
