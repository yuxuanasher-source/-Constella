import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const container = process.env.KNOWLEDGE_SHARE_DB_REGRESSION_CONTAINER;

describe.runIf(Boolean(container))(
  "knowledge share PostgreSQL regression",
  () => {
    it("denies anon/authenticated table access while retaining service-role access", () => {
      const dbContainer = container ?? "";
      expect(
        runSqlText(
          dbContainer,
          `select
             has_table_privilege('anon', 'public.knowledge_share_links', 'SELECT')::text || '|' ||
             has_table_privilege('anon', 'public.knowledge_share_links', 'INSERT')::text || '|' ||
             has_table_privilege('authenticated', 'public.knowledge_share_links', 'SELECT')::text || '|' ||
             has_table_privilege('authenticated', 'public.knowledge_share_links', 'INSERT')::text || '|' ||
             has_table_privilege('authenticated', 'public.knowledge_share_links', 'UPDATE')::text || '|' ||
             has_table_privilege('authenticated', 'public.knowledge_share_links', 'DELETE')::text || '|' ||
             has_table_privilege('service_role', 'public.knowledge_share_links', 'SELECT')::text || '|' ||
             has_table_privilege('service_role', 'public.knowledge_share_links', 'INSERT')::text || '|' ||
             has_table_privilege('service_role', 'public.knowledge_share_links', 'UPDATE')::text || '|' ||
             has_table_privilege('service_role', 'public.knowledge_share_links', 'DELETE')::text;`,
        ),
      ).toBe("false|false|false|false|false|false|true|true|true|true");

      const authenticatedRead = runSqlCapture(
        dbContainer,
        `begin;
         set local role authenticated;
         select count(*) from public.knowledge_share_links;
         commit;`,
      );
      expect(authenticatedRead.code).not.toBe(0);
      expect(authenticatedRead.stderr.toLowerCase()).toContain(
        "permission denied",
      );
    });

    it("selects only active hashes and rejects duplicate retry keys", () => {
      const dbContainer = container ?? "";
      const ids = {
        orgA: "d1000000-0000-4000-8000-000000000001",
        orgB: "d1000000-0000-4000-8000-000000000002",
        actorA: "d1000000-0000-4000-8000-000000000011",
        actorB: "d1000000-0000-4000-8000-000000000012",
        activeA: "d1000000-0000-4000-8000-000000000021",
        activeB: "d1000000-0000-4000-8000-000000000022",
        revokedA: "d1000000-0000-4000-8000-000000000023",
        expiredA: "d1000000-0000-4000-8000-000000000024",
      } as const;
      const cleanupSql = `
        set session_replication_role = replica;
        delete from public.knowledge_share_links
        where organization_id in ('${ids.orgA}'::uuid, '${ids.orgB}'::uuid);
        delete from public.organizations
        where id in ('${ids.orgA}'::uuid, '${ids.orgB}'::uuid);
        delete from public.profiles
        where id in ('${ids.actorA}'::uuid, '${ids.actorB}'::uuid);
        set session_replication_role = origin;
      `;

      runSql(
        dbContainer,
        `${cleanupSql}
         insert into public.organizations (id, name, code) values
           ('${ids.orgA}', 'KB Share A', 'kb-share-regression-a'),
           ('${ids.orgB}', 'KB Share B', 'kb-share-regression-b');
         set session_replication_role = replica;
         insert into public.profiles (id, email, full_name) values
           ('${ids.actorA}', 'kb-share-a@example.invalid', 'Share A'),
           ('${ids.actorB}', 'kb-share-b@example.invalid', 'Share B');
         set session_replication_role = origin;
         insert into public.knowledge_share_links (
           id, organization_id, token_hash, title, source_document_id,
           cos_key, request_key, status, created_by, created_by_name,
           expires_at, revoked_at, revoked_by, created_at
         ) values
           (
             '${ids.activeA}', '${ids.orgA}', repeat('a', 64), 'Active A', 'doc-a',
             'knowledge-base-share/${ids.activeA}.json', 'request-active-a', 'active',
             '${ids.actorA}', 'Share A', now() + interval '7 days', null, null, now()
           ),
           (
             '${ids.activeB}', '${ids.orgB}', repeat('b', 64), 'Active B', 'doc-b',
             'knowledge-base-share/${ids.activeB}.json', 'request-active-b', 'active',
             '${ids.actorB}', 'Share B', now() + interval '7 days', null, null, now()
           ),
           (
             '${ids.revokedA}', '${ids.orgA}', repeat('c', 64), 'Revoked A', 'doc-a',
             'knowledge-base-share/${ids.revokedA}.json', 'request-revoked-a', 'active',
             '${ids.actorA}', 'Share A', now() + interval '7 days', now(), '${ids.actorA}', now()
           ),
           (
             '${ids.expiredA}', '${ids.orgA}', repeat('d', 64), 'Expired A', 'doc-a',
             'knowledge-base-share/${ids.expiredA}.json', 'request-expired-a', 'active',
             '${ids.actorA}', 'Share A', now() - interval '1 day', null, null,
             now() - interval '2 days'
           );`,
      );

      try {
        expect(
          runSqlText(
            dbContainer,
            `set role service_role;
             select
               count(*) filter (
                 where organization_id = '${ids.orgA}'::uuid
                   and token_hash = repeat('a', 64)
                   and status = 'active'
                   and revoked_at is null
                   and expires_at > now()
               )::text || '|' ||
               count(*) filter (
                 where organization_id = '${ids.orgA}'::uuid
                   and token_hash = repeat('c', 64)
                   and status = 'active'
                   and revoked_at is null
                   and expires_at > now()
               )::text || '|' ||
               count(*) filter (
                 where organization_id = '${ids.orgA}'::uuid
                   and token_hash = repeat('d', 64)
                   and status = 'active'
                   and revoked_at is null
                   and expires_at > now()
               )::text || '|' ||
               count(*) filter (
                 where organization_id = '${ids.orgA}'::uuid
                   and status = 'active'
                   and revoked_at is null
                   and expires_at > now()
               )::text
             from public.knowledge_share_links;`,
          ),
        ).toBe("1|0|0|1");

        const duplicateRetry = runSqlCapture(
          dbContainer,
          `insert into public.knowledge_share_links (
             id, organization_id, token_hash, title, source_document_id,
             cos_key, request_key, status, created_by, expires_at
           ) values (
             'd1000000-0000-4000-8000-000000000025', '${ids.orgA}', repeat('e', 64),
             'Duplicate', 'doc-a',
             'knowledge-base-share/d1000000-0000-4000-8000-000000000025.json',
             'request-active-a', 'pending', '${ids.actorA}', now() + interval '7 days'
           );`,
        );
        expect(duplicateRetry.code).not.toBe(0);
        expect(duplicateRetry.stderr.toLowerCase()).toContain(
          "duplicate key value",
        );
        expect(duplicateRetry.stderr.toLowerCase()).toContain(
          "organization_id, created_by, request_key",
        );
        expect(
          runSqlText(
            dbContainer,
            `select count(*)::text from public.knowledge_share_links
             where organization_id = '${ids.orgA}'::uuid
               and created_by = '${ids.actorA}'::uuid
               and request_key = 'request-active-a';`,
          ),
        ).toBe("1");
      } finally {
        runSql(dbContainer, cleanupSql);
      }
    });
  },
);

function runSql(containerName: string, sql: string): void {
  const result = runSqlCapture(containerName, sql);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
}

function runSqlText(containerName: string, sql: string): string {
  return runSqlCapture(containerName, sql).stdout.trim();
}

function runSqlCapture(
  containerName: string,
  sql: string,
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
