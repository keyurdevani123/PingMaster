/**
 * Reusable page-level loading skeleton.
 * Drop this in any page while data is fetching.
 *
 * Usage:
 *   import PageLoader from "../../components/PageLoader";
 *   if (loading) return <PageLoader rows={5} />;
 */
export default function PageLoader({ rows = 4, title = true, header = true }) {
  return (
    <div className="min-h-screen animate-pulse">
      {/* Sticky header skeleton */}
      {header && (
        <div className="sticky top-0 z-20 border-b border-[#1e2129] bg-[#0d0f14] px-6 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="space-y-2">
            {title && <div className="h-5 w-48 bg-[#1e2330] rounded-lg" />}
            <div className="h-3 w-28 bg-[#161a23] rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-24 bg-[#1e2330] rounded-lg" />
            <div className="h-9 w-9 bg-[#1a1e27] rounded-lg" />
          </div>
        </div>
      )}

      {/* Content skeleton */}
      <div className="px-6 md:px-8 py-6 space-y-4">
        {/* KPI / stat bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map((i) => (
            <div key={i} className="h-20 bg-[#0f1217] border border-[#1e2129] rounded-xl p-4">
              <div className="h-2.5 w-16 bg-[#1e2330] rounded mb-3" />
              <div className="h-6 w-10 bg-[#252b3a] rounded" />
            </div>
          ))}
        </div>

        {/* Content rows */}
        <div className="bg-[#0f1217] border border-[#1e2129] rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-3 border-b border-[#1e2129] flex gap-4">
            <div className="h-3 w-24 bg-[#1e2330] rounded" />
            <div className="h-3 w-16 bg-[#1a1e27] rounded" />
            <div className="h-3 w-20 bg-[#1a1e27] rounded" />
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="px-5 py-4 border-b border-[#1a1d24] flex items-center gap-4"
              style={{ opacity: 1 - i * 0.12 }}
            >
              <div className="w-8 h-8 rounded-full bg-[#1e2330] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-[40%] bg-[#1e2330] rounded" />
                <div className="h-2.5 w-[25%] bg-[#161a23] rounded" />
              </div>
              <div className="h-6 w-16 bg-[#1a1e27] rounded-full" />
              <div className="h-6 w-6 bg-[#1e2330] rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
