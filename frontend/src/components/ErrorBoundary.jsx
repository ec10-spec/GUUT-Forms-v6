import React from "react";
import { api } from "../api.js";
import { STALE_RE, reloadForNewVersion } from "../lib/staleVersion.js";

/**
 * Catches a crash in one part of the page so the rest of the app keeps working.
 * variant "page": a full message with Reload and Go to Forms. variant "inline": a small note in place
 * (used for panels such as GUUT AI and the charts). resetKey: change it (for example the route) to try again.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // A tab left open across a deploy: load the new version rather than show an error.
    if (STALE_RE.test(String(error?.message || "")) && reloadForNewVersion()) return;
    try {
      api.logClientError({
        message: String(error?.message || error).slice(0, 500),
        stack: String(error?.stack || "").slice(0, 4000),
        componentStack: String(info?.componentStack || "").slice(0, 4000),
        url: window.location.href,
        kind: `crash:${this.props.area || "page"}`,
      });
    } catch { /* logging must never throw */ }
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.variant === "inline") {
      return (
        <div className="crash-inline" role="alert">
          <strong>{this.props.title || "This part didn't load."}</strong>
          <button className="small" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return (
      <div className="crash-page" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>The problem has been reported. Your saved work is safe.</p>
        <div className="row-gap">
          <button className="primary" onClick={() => window.location.reload()}>Reload</button>
          <button onClick={() => { this.setState({ error: null }); window.location.hash = "/"; }}>Go to Forms</button>
        </div>
      </div>
    );
  }
}
