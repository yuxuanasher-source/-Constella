import { once } from "node:events";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHermesActorFingerprint } from "./actor-fingerprint";
import {
  HERMES_CAPABILITY_MANIFEST_SHA256,
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  HERMES_UPSTREAM_COMMIT,
  HERMES_UPSTREAM_TAG,
  type HermesActorProfile,
} from "./contracts";
import {
  HERMES_GATEWAY_EVENT_TYPES,
  HERMES_GATEWAY_METHODS,
  type HermesGatewayEvent,
} from "./gateway-contracts";
import {
  HERMES_GATEWAY_CLIENT_EVENT_TYPES,
  HERMES_GATEWAY_CLIENT_METHODS,
  attachHermesGatewayBytes,
  createHermesGatewaySession,
  resolveHermesGatewayConfig,
  type HermesGatewayClientConfig,
} from "./gateway-client";
import * as gatewayClientModule from "./gateway-client";

it("classifies only typed ambiguous Gateway transport errors as retryable before acknowledgement", () => {
  const moduleExports = gatewayClientModule as Record<string, unknown>;
  const ErrorType = moduleExports.HermesGatewayError;
  const classify = moduleExports.isAmbiguousHermesGatewayTransportError;

  expect(ErrorType).toBeTypeOf("function");
  expect(classify).toBeTypeOf("function");
  if (typeof ErrorType !== "function" || typeof classify !== "function") return;

  const GatewayError = ErrorType as new (code: string) => Error & {
    code: string;
  };
  const isAmbiguous = classify as (error: unknown) => boolean;
  for (const code of [
    "hermes_gateway_connection_closed",
    "hermes_gateway_rpc_timeout",
    "hermes_gateway_send_failed",
  ]) {
    const error = new GatewayError(code);
    expect(error.code).toBe(code);
    expect(isAmbiguous(error)).toBe(true);
  }
  for (const code of [
    "hermes_gateway_prompt_not_accepted",
    "hermes_gateway_unauthorized",
    "hermes_gateway_capability_invalid",
    "hermes_gateway_protocol_rejected",
    "hermes_gateway_server_rejected",
  ]) {
    expect(isAmbiguous(new GatewayError(code))).toBe(false);
  }
  expect(isAmbiguous(new Error("hermes_gateway_connection_closed"))).toBe(
    false,
  );
});

it("classifies only typed session lifecycle failures as rebuildable", () => {
  const moduleExports = gatewayClientModule as Record<string, unknown>;
  const ErrorType = moduleExports.HermesGatewayError;
  const classify =
    moduleExports.isHermesGatewaySessionLifecycleRebuildableError;

  expect(ErrorType).toBeTypeOf("function");
  expect(classify).toBeTypeOf("function");
  if (typeof ErrorType !== "function" || typeof classify !== "function") return;

  const GatewayError = ErrorType as new (code: string) => Error & {
    code: string;
  };
  const isRebuildable = classify as (error: unknown) => boolean;
  for (const code of [
    "hermes_gateway_session_missing",
    "hermes_gateway_session_not_found",
    "hermes_gateway_session_expired",
    "hermes_gateway_agent_signature_incompatible",
    "hermes_gateway_checkpoint_incompatible",
  ]) {
    expect(isRebuildable(new GatewayError(code))).toBe(true);
  }
  for (const code of [
    "hermes_gateway_unauthorized",
    "hermes_gateway_capability_invalid",
    "hermes_gateway_capability_revoked",
    "hermes_gateway_capability_expired",
    "hermes_gateway_actor_mismatch",
    "hermes_gateway_session_mismatch",
    "hermes_gateway_tenant_mismatch",
    "hermes_gateway_protocol_rejected",
  ]) {
    expect(isRebuildable(new GatewayError(code))).toBe(false);
  }
  expect(isRebuildable(new Error("hermes_gateway_session_expired"))).toBe(
    false,
  );
});

describe("Hermes Gateway JSON-RPC client", () => {
  const servers: WebSocketServer[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const server of servers) {
      for (const client of server.clients) {
        client.terminate();
      }
    }
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    servers.length = 0;
  });

  it("accepts only configured loopback WebSocket URLs and Gateway service tokens", async () => {
    const { server, url } = await fakeGateway();
    servers.push(server);

    const config = resolveHermesGatewayConfig({
      XINGYAO_HERMES_GATEWAY_URL: url.replace("127.0.0.1", "localhost"),
      XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
        "gateway-service-token-that-is-long-enough",
      XINGYAO_READ_API_SERVICE_TOKEN:
        "read-api-service-token-that-must-never-be-used",
    });
    expect(config).toMatchObject({
      url: expect.stringMatching(/^ws:\/\/localhost:\d+\/api\/xingyao\/ws$/),
      serviceToken: "gateway-service-token-that-is-long-enough",
    });
    expect(
      resolveHermesGatewayConfig({
        XINGYAO_HERMES_GATEWAY_URL: `${url}/api/xingyao/ws`,
        XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
          "gateway-service-token-that-is-long-enough",
      })?.url,
    ).toBe(`${url}/api/xingyao/ws`);

    for (const unsafeUrl of [
      "wss://gateway.example.com/v1",
      "ws://192.168.1.5:9000",
      `${url}/api/ws`,
      `${url}/api/other`,
      `${url}/api/other/../xingyao/ws`,
      `${url}/api/%2e/xingyao/ws`,
    ]) {
      expect(
        resolveHermesGatewayConfig({
          XINGYAO_HERMES_GATEWAY_URL: unsafeUrl,
          XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
            "gateway-service-token-that-is-long-enough",
        }),
      ).toBeNull();
    }
    expect(
      resolveHermesGatewayConfig({
        XINGYAO_HERMES_GATEWAY_URL: url,
        XINGYAO_READ_API_SERVICE_TOKEN:
          "read-api-service-token-that-must-never-be-used",
      }),
    ).toBeNull();

    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
    });

    await createHermesGatewaySession(sessionOptions(config!));

    expect(config?.timeouts).toEqual({
      connectMs: 2_000,
      readyMs: 2_000,
      rpcMs: 15_000,
      idleMs: 180_000,
      heartbeatMs: 30_000,
    });
    expect(server.handshakeHeaders.at(0)?.authorization).toBe(
      "Bearer gateway-service-token-that-is-long-enough",
    );
    expect(server.handshakePaths).toEqual(["/api/xingyao/ws"]);
    expect(JSON.stringify(server.handshakeHeaders)).not.toContain(
      "read-api-service-token-that-must-never-be-used",
    );
  });

  it("rejects unsafe direct config URLs before opening a WebSocket", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);

    await expect(
      createHermesGatewaySession(
        sessionOptions({
          ...config,
          url: "ws://192.168.1.5:9000",
        }),
      ),
    ).rejects.toThrow("hermes_gateway_invalid_loopback_url");

    expect(server.handshakeHeaders).toEqual([]);
    expect(server.commands).toEqual([]);
  });

  it("requires a pinned gateway.ready before creating a session", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(
        JSON.stringify(
          readyEvent({
            protocolVersion: "xingyao-hermes-gateway-v3",
            capabilityManifestSha256: "a".repeat(64),
          }),
        ),
      );
    });

    await expect(
      createHermesGatewaySession(sessionOptions(config)),
    ).rejects.toThrow("hermes_gateway_ready_mismatch");

    expect(server.commands).toEqual([]);
    await waitForServerClients(
      server,
      (client) =>
        client.readyState === WebSocket.CLOSED ||
        client.readyState === WebSocket.CLOSING,
    );
  });

  it("correlates concurrent JSON-RPC responses and preserves ordered events", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", {
        sessionId: SESSION_ID,
        checkpointId: CHECKPOINT_ID,
      });
      respondTo(socket, "session.info", { sessionId: SESSION_ID, title: "ok" });
      respondTo(socket, "session.list", { sessions: [SESSION_ID] });
      socket.send(JSON.stringify(event("message.delta", 1, { text: "Hel" })));
      socket.send(JSON.stringify(event("message.delta", 2, { text: "lo" })));
      socket.send(
        JSON.stringify(
          event("tool.start", 3, {
            toolCallId: TOOL_CALL_ID,
            name: "xingyao_get_project_summary",
            label: "Read project",
          }),
        ),
      );
      socket.send(
        JSON.stringify(event("message.complete", 4, { text: "Hello" })),
      );
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    const [info, list, events] = await Promise.all([
      session.info(),
      session.list(),
      collectEvents(session.events, 3),
    ]);

    expect(info).toEqual({ sessionId: SESSION_ID, title: "ok" });
    expect(list).toEqual({ sessions: [SESSION_ID] });
    expect(events.map((item) => item.params.type)).toEqual([
      "message.delta",
      "tool.start",
      "message.complete",
    ]);
    expect(events[0]?.params.payload).toEqual({ text: "Hello" });
    expect(session.checkpointId).toBe(CHECKPOINT_ID);
  });

  it.each([
    [4040, "hermes_gateway_session_not_found", true],
    [4090, "hermes_gateway_rpc_failed", false],
    [4401, "hermes_gateway_rpc_failed", false],
    [4008, "hermes_gateway_rpc_failed", false],
  ] as const)(
    "maps numeric Gateway code %i through the narrow lifecycle boundary",
    async (wireCode, expectedCode, rebuildable) => {
      const { server, config } = await configuredGateway();
      servers.push(server);
      server.on("connection", (socket) => {
        socket.send(JSON.stringify(readyEvent()));
        socket.on("message", (raw) => {
          const command = JSON.parse(raw.toString()) as {
            id: string;
            method: string;
          };
          if (command.method !== "session.resume") return;
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: command.id,
              error: {
                code: wireCode,
                message: "must not cross the Product boundary",
              },
            }),
          );
        });
      });

      const error = await createHermesGatewaySession(
        sessionOptions(config, { sessionId: SESSION_ID }),
      ).catch((candidate: unknown) => candidate);

      expect(error).toMatchObject({ code: expectedCode });
      expect(
        gatewayClientModule.isHermesGatewaySessionLifecycleRebuildableError(
          error,
        ),
      ).toBe(rebuildable);
      expect(String(error)).not.toContain("must not cross");
    },
  );

  it("pins the exact official method and product-visible event surface", async () => {
    expect(HERMES_GATEWAY_CLIENT_METHODS).toEqual(HERMES_GATEWAY_METHODS);
    expect(HERMES_GATEWAY_CLIENT_EVENT_TYPES).toEqual(
      HERMES_GATEWAY_EVENT_TYPES,
    );
    expect(HERMES_GATEWAY_CLIENT_METHODS).toEqual([
      "session.create",
      "session.resume",
      "session.info",
      "session.list",
      "session.branch",
      "session.compress",
      "image.attach_bytes",
      "pdf.attach",
      "file.attach",
      "prompt.submit",
      "clarify.respond",
      "session.interrupt",
    ]);
    expect(HERMES_GATEWAY_CLIENT_EVENT_TYPES).not.toContain("reasoning.delta");
    expect(HERMES_GATEWAY_CLIENT_EVENT_TYPES).not.toContain("thinking.delta");
  });

  it("sends only byte-backed attachments from product-resolved bytes", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
      respondTo(socket, "image.attach_bytes", { attachmentId: ATTACHMENT_ID });
      respondTo(socket, "pdf.attach", { attachmentId: ATTACHMENT_ID });
      respondTo(socket, "file.attach", { attachmentId: ATTACHMENT_ID });
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    await expect(
      attachHermesGatewayBytes(session, {
        attachmentId: ATTACHMENT_ID,
        filename: "evidence.png",
        mimeType: "image/png",
        bytes: Buffer.from("image"),
      }),
    ).resolves.toEqual({ attachmentId: ATTACHMENT_ID });
    await expect(
      attachHermesGatewayBytes(session, {
        attachmentId: ATTACHMENT_ID,
        filename: "evidence.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.from("pdf"),
      }),
    ).resolves.toEqual({ attachmentId: ATTACHMENT_ID });
    await expect(
      attachHermesGatewayBytes(session, {
        attachmentId: ATTACHMENT_ID,
        filename: "evidence.csv",
        mimeType: "text/csv",
        bytes: Buffer.from("file"),
      }),
    ).resolves.toEqual({ attachmentId: ATTACHMENT_ID });
    await expect(
      attachHermesGatewayBytes(session, {
        attachmentId: ATTACHMENT_ID,
        filename: "leak.txt",
        mimeType: "text/plain",
        path: "C:\\secret.txt",
      } as never),
    ).rejects.toThrow("hermes_gateway_attachment_requires_bytes");

    expect(
      server.commands
        .filter((command) => String(command.method).includes("attach"))
        .map((command) => command.method),
    ).toEqual(["image.attach_bytes", "pdf.attach", "file.attach"]);
    expect(JSON.stringify(server.commands)).not.toContain("C:\\secret.txt");
  });

  it("exposes clarify and interrupt handles and fails closed on private or drifted events", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
      respondTo(socket, "clarify.respond", { accepted: true });
      respondTo(socket, "session.interrupt", { interrupted: true }, () => {
        socket.send(
          JSON.stringify(event("reasoning.delta", 2, { text: "no" })),
        );
        socket.send(
          JSON.stringify(
            event("turn.terminal", 3, {
              outcome: "timed_out",
              message: "drift",
              metadata: metadata(),
            }),
          ),
        );
      });
      socket.send(
        JSON.stringify(
          event("clarify.request", 1, {
            requestId: CLARIFY_REQUEST_ID,
            question: "Which evidence?",
            choices: ["Project", "Settlement"],
          }),
        ),
      );
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    const [clarify] = await collectEvents(session.events, 1);
    await expect(
      session.respondToClarify({
        requestId: CLARIFY_REQUEST_ID,
        answer: "Project",
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(session.interrupt()).resolves.toEqual({ interrupted: true });

    await expect(collectEvents(session.events, 1)).rejects.toThrow(
      "hermes_gateway_event_schema_mismatch",
    );
    await expect(session.info()).rejects.toThrow(
      "hermes_gateway_event_schema_mismatch",
    );
    expect(clarify?.params.type).toBe("clarify.request");
    expect(JSON.stringify(server.commands)).not.toContain("reasoning.delta");
  });

  it("resumes the same invocation after prompt acceptance instead of duplicating prompt.submit", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    let firstSocket: WebSocket | null = null;
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      if (!firstSocket) {
        firstSocket = socket;
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          {
            accepted: true,
            invocationId: INVOCATION_ID,
          },
          () => socket.close(),
        );
        return;
      }
      respondTo(socket, "session.resume", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
      });
      respondTo(socket, "session.info", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
        status: "accepted",
      });
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Compare project evidence" }),
    );
    await session.waitForAccepted();
    await session.recover();

    expect(
      server.commands.filter((command) => command.method === "prompt.submit"),
    ).toHaveLength(1);
    expect(server.commands.map((command) => command.method)).toContain(
      "session.resume",
    );
    expect(server.commands.map((command) => command.method)).toContain(
      "session.info",
    );
  });

  it("automatically resumes event delivery after an accepted prompt loses its socket", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    let connectionCount = 0;
    server.on("connection", (socket) => {
      connectionCount += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (connectionCount === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          { accepted: true, invocationId: INVOCATION_ID },
          () => {
            socket.send(
              JSON.stringify(event("message.complete", 1, { text: "working" })),
            );
            socket.close();
          },
        );
        return;
      }
      respondTo(socket, "session.resume", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
      });
      respondTo(
        socket,
        "session.info",
        {
          sessionId: SESSION_ID,
          invocationId: INVOCATION_ID,
          actorFingerprint: ACTOR_FINGERPRINT,
          status: "accepted",
        },
        () =>
          socket.send(
            JSON.stringify(
              event("turn.terminal", 2, {
                outcome: "complete",
                message: "done",
                metadata: metadata(),
              }),
            ),
          ),
      );
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Continue reliably" }),
    );
    const events = await collectEvents(session.events, 2);

    expect(events.map((item) => item.params.type)).toEqual([
      "message.complete",
      "turn.terminal",
    ]);
    expect(connectionCount).toBe(2);
    expect(
      server.commands.filter((command) => command.method === "prompt.submit"),
    ).toHaveLength(1);
  });

  it("resumes recorded and branched sessions instead of creating replacement sessions", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    const branchedSessionId = "session-branched";
    let createCount = 0;
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      socket.on("message", (raw) => {
        const command = JSON.parse(raw.toString()) as {
          id: string;
          method: string;
          params: Record<string, unknown>;
        };
        if (command.method === "session.create") {
          createCount += 1;
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: command.id,
              result: {
                sessionId: createCount === 1 ? SESSION_ID : branchedSessionId,
                invocationId: INVOCATION_ID,
                actorFingerprint: ACTOR_FINGERPRINT,
              },
            }),
          );
        }
        if (command.method === "session.resume") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: command.id,
              result: {
                sessionId: command.params.sessionId,
                checkpointId:
                  command.params.sessionId === branchedSessionId
                    ? "checkpoint-branched"
                    : "checkpoint-resumed",
                invocationId: INVOCATION_ID,
                actorFingerprint: ACTOR_FINGERPRINT,
              },
            }),
          );
        }
        if (command.method === "session.branch") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: command.id,
              result: {
                sessionId: branchedSessionId,
                checkpointId: "checkpoint-branched",
                invocationId: INVOCATION_ID,
                actorFingerprint: ACTOR_FINGERPRINT,
              },
            }),
          );
        }
        if (command.method === "prompt.submit") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: command.id,
              result: { accepted: true, invocationId: INVOCATION_ID },
            }),
          );
        }
      });
    });

    const source = await createHermesGatewaySession(
      sessionOptions(config, { sessionId: SESSION_ID }),
    );
    const branch = await source.branch({
      conversationId: CONVERSATION_ID,
      checkpointId: CHECKPOINT_ID,
    });
    source.close();
    const branched = await createHermesGatewaySession(
      sessionOptions(config, {
        sessionId: branchedSessionId,
        prompt: "retry from checkpoint",
      }),
    );

    expect(branch).toEqual({
      sessionId: branchedSessionId,
      checkpointId: "checkpoint-branched",
      invocationId: INVOCATION_ID,
      actorFingerprint: ACTOR_FINGERPRINT,
    });
    expect(branched.sessionId).toBe(branchedSessionId);
    expect(source.checkpointId).toBe("checkpoint-resumed");
    expect(branched.checkpointId).toBe("checkpoint-branched");
    expect(server.commands.map((command) => command.method)).toEqual([
      "session.resume",
      "session.branch",
      "session.resume",
      "prompt.submit",
    ]);
    expect(server.commands.map((command) => command.params.sessionId)).toEqual([
      SESSION_ID,
      SESSION_ID,
      branchedSessionId,
      branchedSessionId,
    ]);
    expect(server.commands[1]?.params).toEqual({
      actorAssertion: ACTOR_ASSERTION,
      invocationId: INVOCATION_ID,
      invocationCapability: INVOCATION_CAPABILITY,
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      checkpointId: CHECKPOINT_ID,
    });
  });

  it("uses a second bounded recovery after gateway.ready times out", async () => {
    const { server, config } = await configuredGateway({
      timeouts: {
        connectMs: 100,
        readyMs: 30,
        rpcMs: 100,
        idleMs: 1_000,
        heartbeatMs: 1_000,
      },
    });
    servers.push(server);
    let connectionCount = 0;
    server.on("connection", (socket) => {
      connectionCount += 1;
      if (connectionCount === 2) return;

      socket.send(JSON.stringify(readyEvent()));
      if (connectionCount === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          { accepted: true, invocationId: INVOCATION_ID },
          () => socket.close(),
        );
        return;
      }

      respondTo(socket, "session.resume", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
      });
      respondTo(
        socket,
        "session.info",
        {
          sessionId: SESSION_ID,
          invocationId: INVOCATION_ID,
          actorFingerprint: ACTOR_FINGERPRINT,
          status: "accepted",
        },
        () =>
          socket.send(
            JSON.stringify(
              event("turn.terminal", 1, {
                outcome: "complete",
                message: "recovered",
                metadata: metadata(),
              }),
            ),
          ),
      );
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Recover twice" }),
    );
    const events = await collectEvents(session.events, 1);

    expect(events[0]?.params.type).toBe("turn.terminal");
    expect(connectionCount).toBe(3);
    expect(session.listenerCount()).toBe(3);
    session.close();
    expect(session.listenerCount()).toBe(0);
  });

  it("does not resubmit prompt when the prompt response is lost after gateway receipt", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    let connection = 0;
    server.on("connection", (socket) => {
      connection += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (connection === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        closeOn(socket, "prompt.submit");
        return;
      }
      respondTo(socket, "session.resume", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
      });
      respondTo(socket, "session.info", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
        status: "accepted",
      });
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Compare project evidence" }),
    );
    await session.waitForAccepted();

    expect(
      server.commands.filter((command) => command.method === "prompt.submit"),
    ).toHaveLength(1);
    expect(server.commands.map((command) => command.method)).toContain(
      "session.resume",
    );
    expect(server.commands.map((command) => command.method)).toContain(
      "session.info",
    );
  });

  it("may retry safely when the connection drops before prompt acceptance", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    let connection = 0;
    server.on("connection", (socket) => {
      connection += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (connection === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID }, () =>
          socket.close(),
        );
        return;
      }
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
      respondTo(socket, "prompt.submit", {
        accepted: true,
        invocationId: INVOCATION_ID,
      });
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Compare project evidence" }),
    );
    await session.waitForAccepted();

    expect(
      server.commands.filter((command) => command.method === "prompt.submit"),
    ).toHaveLength(1);
  });

  it("validates resume and session.info results against the same session and invocation", async () => {
    const sessionMismatch = await configuredGateway();
    servers.push(sessionMismatch.server);
    let sessionMismatchConnection = 0;
    sessionMismatch.server.on("connection", (socket) => {
      sessionMismatchConnection += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (sessionMismatchConnection === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          { accepted: true, invocationId: INVOCATION_ID },
          () => socket.close(),
        );
        return;
      }
      respondTo(socket, "session.resume", { sessionId: "other-session" });
    });
    const session = await createHermesGatewaySession(
      sessionOptions(sessionMismatch.config, {
        prompt: "Compare project evidence",
      }),
    );
    await expect(session.recover()).rejects.toThrow(
      "hermes_gateway_session_mismatch",
    );

    const actorMismatch = await configuredGateway();
    servers.push(actorMismatch.server);
    let actorMismatchConnection = 0;
    actorMismatch.server.on("connection", (socket) => {
      actorMismatchConnection += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (actorMismatchConnection === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          { accepted: true, invocationId: INVOCATION_ID },
          () => socket.close(),
        );
        return;
      }
      respondTo(socket, "session.resume", {
        sessionId: SESSION_ID,
        invocationId: INVOCATION_ID,
      });
      respondTo(socket, "session.info", {
        sessionId: SESSION_ID,
        invocationId: "99999999-9999-4999-8999-999999999999",
      });
    });
    const actorSession = await createHermesGatewaySession(
      sessionOptions(actorMismatch.config, {
        prompt: "Compare project evidence",
      }),
    );
    await expect(actorSession.recover()).rejects.toThrow(
      "hermes_gateway_actor_mismatch",
    );
  });

  it("rejects recovery status without invocation and actor identity", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    let connection = 0;
    server.on("connection", (socket) => {
      connection += 1;
      socket.send(JSON.stringify(readyEvent()));
      if (connection === 1) {
        respondTo(socket, "session.create", { sessionId: SESSION_ID });
        respondTo(
          socket,
          "prompt.submit",
          { accepted: true, invocationId: INVOCATION_ID },
          () => socket.close(),
        );
        return;
      }
      respondTo(socket, "session.resume", { sessionId: SESSION_ID });
      respondTo(socket, "session.info", {
        sessionId: SESSION_ID,
        status: "accepted",
      });
    });

    const session = await createHermesGatewaySession(
      sessionOptions(config, { prompt: "Compare project evidence" }),
    );
    await expect(session.recover()).rejects.toThrow(
      "hermes_gateway_actor_mismatch",
    );
  });

  it("does not reconnect after fatal protocol drift", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
      socket.on("message", (raw) => {
        const command = JSON.parse(raw.toString()) as { method: string };
        if (command.method === "session.info") {
          socket.send(
            JSON.stringify(event("thinking.delta", 1, { text: "no" })),
          );
        }
      });
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    await expect(session.info()).rejects.toThrow(
      "hermes_gateway_event_schema_mismatch",
    );
    const handshakesAfterFatal = server.handshakeHeaders.length;

    await expect(session.recover()).rejects.toThrow(
      "hermes_gateway_event_schema_mismatch",
    );
    expect(server.handshakeHeaders).toHaveLength(handshakesAfterFatal);
    expect(session.listenerCount()).toBe(0);
  });

  it("fails closed on Actor/session mismatch and redacts capability from errors", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.resume", { sessionId: "other-session" });
    });

    await expect(
      createHermesGatewaySession(
        sessionOptions(config, { sessionId: SESSION_ID }),
      ),
    ).rejects.toThrow("hermes_gateway_session_mismatch");
    await waitForServerClients(
      server,
      (client) => client.readyState === WebSocket.CLOSED,
    );

    const redactionGateway = await configuredGateway();
    servers.push(redactionGateway.server);
    redactionGateway.server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondWithError(
        socket,
        "session.create",
        "upstream leaked super-secret-capability",
      );
    });
    await expect(
      createHermesGatewaySession({
        ...sessionOptions(redactionGateway.config),
        invocationCapability: "super-secret-capability",
      }),
    ).rejects.not.toThrow("super-secret-capability");
  });

  it("redacts configured sensitive values and maps unsafe upstream errors", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    const serviceToken = "sk_live_secret_gateway_token_1234567890";
    const actorAssertion = "signed.actor.assertion.with.secret";
    const invocationCapability = "hcap_abc123secret";
    const opaqueCapability = "opaque-runtime-capability-secret";
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondWithError(socket, "session.create", {
        code: `leaked ${serviceToken}`,
        message: `${actorAssertion} ${invocationCapability} ${opaqueCapability}`,
      });
    });

    await expect(
      createHermesGatewaySession({
        ...sessionOptions({
          ...config,
          serviceToken,
          opaqueCapability,
        }),
        actorAssertion,
        invocationCapability,
      }),
    ).rejects.toThrow("hermes_gateway_rpc_failed");
    await expect(
      createHermesGatewaySession({
        ...sessionOptions({
          ...config,
          serviceToken,
          opaqueCapability,
        }),
        actorAssertion,
        invocationCapability,
      }),
    ).rejects.not.toThrow(serviceToken);
  });

  it("handles pre-open connection failures without unhandled ready rejection", async () => {
    await expect(
      createHermesGatewaySession(
        sessionOptions({
          url: "ws://127.0.0.1:9",
          serviceToken: "gateway-service-token-that-is-long-enough",
          timeouts: {
            connectMs: 50,
            readyMs: 50,
            rpcMs: 50,
            idleMs: 50,
            heartbeatMs: 50,
          },
        }),
      ),
    ).rejects.toThrow(/hermes_gateway_(connect_failed|connect_timeout)/);
  });

  it("bounds connect, heartbeat, RPC, and idle timeouts and close clears listeners and timers", async () => {
    const { server, config } = await configuredGateway({
      timeouts: {
        connectMs: 50,
        readyMs: 50,
        rpcMs: 50,
        idleMs: 500,
        heartbeatMs: 10,
      },
    });
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    const pending = session.info();
    await expect(pending).rejects.toThrow("hermes_gateway_rpc_timeout");

    session.close();
    expect(session.listenerCount()).toBe(0);
  });

  it("closes only the local transport and leaves the server session reusable", async () => {
    const { server, config } = await configuredGateway();
    servers.push(server);
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(readyEvent()));
      respondTo(socket, "session.create", { sessionId: SESSION_ID });
    });

    const session = await createHermesGatewaySession(sessionOptions(config));
    session.close();
    await waitForServerClients(
      server,
      (client) => client.readyState === WebSocket.CLOSED,
    );

    expect(server.commands.map((command) => command.method)).toEqual([
      "session.create",
    ]);
  });
});

const SESSION_ID = "gateway-session-1";
const CHECKPOINT_ID = "checkpoint-source";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const TOOL_CALL_ID = "66666666-6666-4666-8666-666666666666";
const CLARIFY_REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const ATTACHMENT_ID = "88888888-8888-4888-8888-888888888888";
const ACTOR_ASSERTION = "signed.actor.assertion";
const ACTOR_FINGERPRINT = createHermesActorFingerprint(profile());
const INVOCATION_CAPABILITY = "opaque-invocation-capability";

function sessionOptions(
  config: HermesGatewayClientConfig,
  overrides: Partial<Parameters<typeof createHermesGatewaySession>[0]> = {},
): Parameters<typeof createHermesGatewaySession>[0] {
  return {
    config,
    actor: profile(),
    actorAssertion: ACTOR_ASSERTION,
    invocationCapability: INVOCATION_CAPABILITY,
    conversationId: CONVERSATION_ID,
    sessionId: overrides.sessionId,
    ...overrides,
  };
}

function profile(): HermesActorProfile {
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["context.read", "projects.search"],
    enabledSkillVersions: [],
    skillGrantsHash:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
  };
}

async function configuredGateway(
  overrides: Partial<HermesGatewayClientConfig> = {},
) {
  const { server, url } = await fakeGateway();
  const config = resolveHermesGatewayConfig({
    XINGYAO_HERMES_GATEWAY_URL: url,
    XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
      "gateway-service-token-that-is-long-enough",
  });
  expect(config).not.toBeNull();
  return {
    server,
    config: {
      ...config!,
      ...overrides,
      timeouts: { ...config!.timeouts, ...overrides.timeouts },
    },
  };
}

async function fakeGateway() {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  }) as WebSocketServer & {
    commands: Array<{
      id: string;
      method: string;
      params: Record<string, unknown>;
    }>;
    handshakeHeaders: Array<Record<string, string | undefined>>;
    handshakePaths: string[];
  };
  server.commands = [];
  server.handshakeHeaders = [];
  server.handshakePaths = [];
  server.on("connection", (socket, request) => {
    server.handshakeHeaders.push(
      request.headers as Record<string, string | undefined>,
    );
    server.handshakePaths.push(request.url ?? "");
    socket.on("message", (raw) => {
      try {
        const command = JSON.parse(raw.toString()) as {
          id: string;
          method: string;
          params: Record<string, unknown>;
        };
        if (command.method !== "ping") {
          server.commands.push(command);
        }
      } catch {
        // Tests assert client behavior, not malformed server capture.
      }
    });
  });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("unexpected_test_server_address");
  }
  return { server, url: `ws://127.0.0.1:${address.port}` };
}

function respondTo(
  socket: WebSocket,
  method: string,
  result: Record<string, unknown>,
  afterSend?: () => void,
) {
  socket.on("message", (raw) => {
    const command = JSON.parse(raw.toString()) as {
      id: string;
      method: string;
    };
    if (command.method === method) {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: command.id, result }));
      afterSend?.();
    }
  });
}

function respondWithError(
  socket: WebSocket,
  method: string,
  error: string | { code: string; message?: string },
) {
  socket.on("message", (raw) => {
    const command = JSON.parse(raw.toString()) as {
      id: string;
      method: string;
    };
    if (command.method === method) {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: command.id,
          error: typeof error === "string" ? { code: error } : error,
        }),
      );
    }
  });
}

function closeOn(socket: WebSocket, method: string) {
  socket.on("message", (raw) => {
    const command = JSON.parse(raw.toString()) as {
      method: string;
    };
    if (command.method === method) {
      socket.close();
    }
  });
}

async function waitForServerClients(
  server: WebSocketServer,
  predicate: (client: WebSocket) => boolean,
) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if ([...server.clients].every(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect([...server.clients].map((client) => client.readyState)).toEqual(
    expect.arrayContaining([WebSocket.CLOSED]),
  );
}

function readyEvent(overrides: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      type: "gateway.ready",
      payload: {
        status: "ready",
        upstreamTag: HERMES_UPSTREAM_TAG,
        upstreamCommit: HERMES_UPSTREAM_COMMIT,
        forkCommit: "a9c8ea249494075ab7180c7a9df4b07b478d4708",
        protocolVersion: HERMES_PROTOCOL_VERSION,
        profileVersion: HERMES_PROFILE_VERSION,
        capabilityManifestSha256: HERMES_CAPABILITY_MANIFEST_SHA256,
        ...overrides,
      },
    },
  };
}

function event(
  type: string,
  sequence: number,
  payload: Record<string, unknown>,
) {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      type,
      sessionId: SESSION_ID,
      invocationId: INVOCATION_ID,
      sequence,
      payload,
    },
  };
}

function metadata() {
  return {
    evidenceRefs: [],
    sourceLabels: [],
    updatedAt: "2026-07-22T10:00:00.000Z",
    missingData: [],
    permissionDenials: [],
    truncated: false,
  };
}

async function collectEvents(
  stream: AsyncIterable<HermesGatewayEvent>,
  count: number,
) {
  const events: HermesGatewayEvent[] = [];
  for await (const item of stream) {
    events.push(item);
    if (events.length === count) break;
  }
  return events;
}
