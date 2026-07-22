import { describe, expect, it } from "vitest";

import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";
import {
  HERMES_PROFILE_VERSION,
  type HermesActorProfile,
  type HermesAuthRole,
} from "./contracts";
import { authorizeLiveHermesActor } from "./live-actor-authorization";
import { getAllowedReadScopesForRole } from "./read-scopes";
import { evaluateHermesSkillGrantsForActor } from "./skill-governance";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";

describe("Hermes live actor authorization", () => {
  it("queries active organization membership on every invocation", async () => {
    const actor = profile("finance");
    const { client, queries } = membershipClient([
      { data: { role: "finance" }, error: null },
      { data: { role: "finance" }, error: null },
    ]);

    await expect(
      authorizeLiveHermesActor({
        client,
        actorSnapshot: actor,
        expectedActorFingerprint: createHermesActorFingerprint(actor),
      }),
    ).resolves.toEqual({
      actor,
      actorFingerprint: createHermesActorFingerprint(actor),
    });
    await authorizeLiveHermesActor({
      client,
      actorSnapshot: actor,
      expectedActorFingerprint: createHermesActorFingerprint(actor),
    });

    expect(queries).toEqual([
      {
        table: "organization_members",
        select: "role",
        filters: [
          ["organization_id", ORGANIZATION_ID],
          ["user_id", USER_ID],
          ["status", "active"],
        ],
      },
      {
        table: "organization_members",
        select: "role",
        filters: [
          ["organization_id", ORGANIZATION_ID],
          ["user_id", USER_ID],
          ["status", "active"],
        ],
      },
    ]);
  });

  it.each([
    [{ data: null, error: null }, "membership_inactive"],
    [{ data: { role: "admin" }, error: null }, "unknown_role"],
    [
      { data: null, error: new Error("database unavailable") },
      "membership_query_failed",
    ],
  ] as const)(
    "fails closed for invalid live membership",
    async (response, code) => {
      const actor = profile("owner");
      const { client } = membershipClient([response]);

      await expect(
        authorizeLiveHermesActor({
          client,
          actorSnapshot: actor,
          expectedActorFingerprint: createHermesActorFingerprint(actor),
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("normalizes a rejected membership query without exposing its cause", async () => {
    const actor = profile("owner");
    const rawMessage = "network select failed with bearer-secret";
    const { client } = membershipClient([new Error(rawMessage)]);

    const error = await authorizeLiveHermesActor({
      client,
      actorSnapshot: actor,
      expectedActorFingerprint: createHermesActorFingerprint(actor),
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({ code: "membership_query_failed" });
    expect(String(error)).not.toContain(rawMessage);
  });

  it("invalidates the actor after a live role downgrade", async () => {
    const actor = profile("owner");
    const { client } = membershipClient([
      { data: { role: "finance" }, error: null },
    ]);

    await expect(
      authorizeLiveHermesActor({
        client,
        actorSnapshot: actor,
        expectedActorFingerprint: createHermesActorFingerprint(actor),
      }),
    ).rejects.toMatchObject({ code: "actor_changed" });
  });

  it("rejects scope expansion and a changed Skill grant set", async () => {
    const restrictedActor = profile("owner", ["context.read"]);
    const restrictedClient = membershipClient([
      { data: { role: "owner" }, error: null },
    ]).client;
    await expect(
      authorizeLiveHermesActor({
        client: restrictedClient,
        actorSnapshot: restrictedActor,
        expectedActorFingerprint: createHermesActorFingerprint(restrictedActor),
      }),
    ).rejects.toMatchObject({ code: "actor_changed" });

    const actor = profile("finance");
    const changedGrants = actor.enabledSkillVersions.map((grant, index) =>
      index === 0 ? { ...grant, version: "9.0.0" } : grant,
    );
    const changedClient = membershipClient([
      { data: { role: "finance" }, error: null },
    ]).client;
    await expect(
      authorizeLiveHermesActor({
        client: changedClient,
        actorSnapshot: actor,
        expectedActorFingerprint: createHermesActorFingerprint(actor),
        resolveSkillGrants: async () => changedGrants,
      }),
    ).rejects.toMatchObject({ code: "actor_changed" });
  });

  it("rejects a stale or internally inconsistent frozen grant hash", async () => {
    const actor = profile("finance");
    const poisoned = { ...actor, skillGrantsHash: "a".repeat(64) };
    const { client } = membershipClient([
      { data: { role: "finance" }, error: null },
    ]);

    await expect(
      authorizeLiveHermesActor({
        client,
        actorSnapshot: poisoned,
        expectedActorFingerprint: createHermesActorFingerprint(poisoned),
      }),
    ).rejects.toMatchObject({ code: "invalid_snapshot" });
  });
});

function profile(
  role: HermesAuthRole,
  scopes = getAllowedReadScopesForRole(role),
): HermesActorProfile {
  const evaluation = evaluateHermesSkillGrantsForActor({
    role,
    allowedReadScopes: scopes,
  });
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role,
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: scopes,
    enabledSkillVersions: evaluation.enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(
      evaluation.enabledSkillVersions,
    ),
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: { pageType: "global", objectIds: [] },
  };
}

type MembershipResponse =
  | {
      data: { role: string } | null;
      error: Error | null;
    }
  | Error;

function membershipClient(responses: readonly MembershipResponse[]) {
  const queue = [...responses];
  const queries: Array<{
    table: string;
    select: string;
    filters: Array<[string, unknown]>;
  }> = [];
  const client = {
    from(table: string) {
      const query = {
        table,
        select: "",
        filters: [] as Array<[string, unknown]>,
      };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          const response = queue.shift() ?? { data: null, error: null };
          if (response instanceof Error) throw response;
          return response;
        },
      };
      return builder;
    },
  };
  return { client, queries };
}
