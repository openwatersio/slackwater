import { Component, type ReactNode } from "react";

export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p role="status" className="m-0 p-4 text-sm">
        Map unavailable.
      </p>
    ) : (
      this.props.children
    );
  }
}
