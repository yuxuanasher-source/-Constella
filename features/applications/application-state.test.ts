import { describe, expect, it } from "vitest";

import {
  assertApplicationTransition,
  assertCanSubmitRecording,
} from "./application-state";

describe("application admission state", () => {
  it("allows the screening path through recording approval and final join", () => {
    expect(() =>
      assertApplicationTransition("submitted", "recording_reviewing"),
    ).not.toThrow();
    expect(() =>
      assertApplicationTransition("recording_reviewing", "recording_approved"),
    ).not.toThrow();
    expect(() =>
      assertApplicationTransition("recording_approved", "joined"),
    ).not.toThrow();
  });

  it("allows staff to confirm a direct invitation as joined", () => {
    expect(() =>
      assertApplicationTransition("invited", "joined"),
    ).not.toThrow();
  });

  it("does not treat recording approval as project join", () => {
    expect(() =>
      assertApplicationTransition("recording_reviewing", "joined"),
    ).toThrow("Cannot move application from recording_reviewing to joined");
  });

  it("allows rejected and needs-changes applications to submit another recording", () => {
    expect(() => assertCanSubmitRecording("recording_rejected")).not.toThrow();
    expect(() => assertCanSubmitRecording("recording_required")).not.toThrow();
  });

  it("blocks recording submission after the streamer has joined or declined", () => {
    expect(() => assertCanSubmitRecording("joined")).toThrow(
      "Cannot submit recording while application is joined",
    );
    expect(() => assertCanSubmitRecording("declined")).toThrow(
      "Cannot submit recording while application is declined",
    );
  });
});
