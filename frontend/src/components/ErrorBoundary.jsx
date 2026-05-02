import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("frontend_runtime_error", {
      message: error?.message || "Unknown frontend error",
      stack: error?.stack || null,
      componentStack: info?.componentStack || null,
    });
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] flex items-center justify-center px-6">
        <div className="w-full max-w-xl rounded-2xl border border-[#252a33] bg-[#0f1217] p-7 shadow-2xl">
          <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Application Error</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">We could not load this screen safely.</h1>
          <p className="mt-3 text-sm leading-6 text-[#9aa2b1]">
            A runtime error interrupted the app. This can happen when session data or a backend response is incomplete.
            Refresh once to retry with a clean state.
          </p>
          {this.state.error?.message ? (
            <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {this.state.error.message}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="h-10 px-5 rounded-lg bg-white text-black text-sm font-semibold"
            >
              Refresh App
            </button>
          </div>
        </div>
      </div>
    );
  }
}
