// Pixel-parity guard for the ops-reference refactor.
//
// The 13.8k-line ops-reference.jsx is being split into per-module files
// (its original `src/*.jsx` boundaries). Because every component is a
// top-level function with inline styles, moving them between files must not
// change a single byte of rendered output. This test renders every nav route
// and snapshots the serialized DOM (which includes all inline styles), so any
// drift introduced while extracting modules fails loudly.
//
// Determinism: Date is frozen and Math.random is seeded, because a couple of
// screens render "now"-derived text. Only Date is faked (not timers) so
// HeroUI / react-aria internals keep working.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

const ROUTES = [
  "warroom",
  "projects",
  "streamers",
  "admission",
  "tasks",
  "reports",
  "settle",
  "billing",
  "export",
  "audit",
  "org",
];

describe("ops-reference render parity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-26T08:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.4242);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  for (const route of ROUTES) {
    it(`renders the ${route} route identically`, () => {
      const { container } = render(<OpsReferenceApp initialRoute={route} />);
      expect(container.innerHTML).toMatchSnapshot();
    });
  }
});
