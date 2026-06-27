import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  assertShowcaseExecutionAllowed,
  buildAccountLookupPlan,
  createProductShowcaseRunner,
  normalizeAccountIdentifier,
} from "./product-showcase-data-fixture.mjs";

const { command, options } = parseCliArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

try {
  const env = loadEnv();
  assertShowcaseExecutionAllowed(env);
  const adapter = createSupabaseAdapter(env);
  const runner = createProductShowcaseRunner(adapter);
  const summary = await runCommand(runner, command, options);
  printSummary(`${command} product showcase data`, summary);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function runCommand(runner, commandName, options) {
  const input = {
    account: options.account,
    organizationId: options.organizationId,
  };

  if (commandName === "load") {
    return runner.load(input);
  }
  if (commandName === "verify") {
    return runner.verify(input);
  }
  if (commandName === "clear") {
    return runner.clear(input);
  }

  throw new Error(`Unknown command: ${commandName}`);
}

function createSupabaseAdapter(env) {
  const client = createClient(
    requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return {
    async resolveTargetAccount(accountInput) {
      const lookupPlan = buildAccountLookupPlan(accountInput);
      for (const lookup of lookupPlan) {
        const { data, error } = await client
          .from("profiles")
          .select("id, email, full_name, phone, login_account")
          .eq(lookup.column, lookup.value)
          .maybeSingle();
        if (error) {
          throw error;
        }
        if (data) {
          return data;
        }
      }

      throw new Error(
        `Target account was not found in public.profiles: ${normalizeAccountIdentifier(
          accountInput,
        )}`,
      );
    },

    async resolveTargetOrganization(targetAccount, options) {
      if (options?.organizationId) {
        const organization = await getOrganizationById(options.organizationId);
        await ensureActiveMembership(organization.id, targetAccount.id);
        return organization;
      }

      const membership = await getFirstActiveMembership(targetAccount.id);
      if (membership) {
        return membership;
      }

      const code = `product-showcase-account-${shortHash(targetAccount.id)}`;
      const { data, error } = await client
        .from("organizations")
        .upsert(
          {
            name: `产品展示组织 ${displayAccountLabel(targetAccount)}`,
            code,
          },
          { onConflict: "code" },
        )
        .select("id, name, code")
        .single();
      if (error) {
        throw error;
      }

      await ensureActiveMembership(data.id, targetAccount.id, "owner");
      return data;
    },

    async clearRows(manifest) {
      await clearShowcaseRows(client, manifest);
    },

    async insertRows(rows) {
      await insertShowcaseRows(client, rows);
    },

    async summarize(manifest, targetAccount) {
      return summarizeShowcaseRows(client, manifest, targetAccount);
    },
  };

  async function getOrganizationById(organizationId) {
    const { data, error } = await client
      .from("organizations")
      .select("id, name, code")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error(`Organization was not found: ${organizationId}`);
    }
    return data;
  }

  async function getFirstActiveMembership(userId) {
    const { data, error } = await client
      .from("organization_members")
      .select("organization_id, organizations(id, name, code), created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const organization = Array.isArray(data.organizations)
      ? data.organizations[0]
      : data.organizations;
    if (!organization) {
      return getOrganizationById(data.organization_id);
    }
    return organization;
  }

  async function ensureActiveMembership(
    organizationId,
    userId,
    role = "owner",
  ) {
    const { data, error } = await client
      .from("organization_members")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data) {
      if (data.status !== "active") {
        const { error: updateError } = await client
          .from("organization_members")
          .update({ status: "active" })
          .eq("id", data.id);
        if (updateError) {
          throw updateError;
        }
      }
      return;
    }

    const { error: insertError } = await client
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        role,
        status: "active",
      });
    if (insertError) {
      throw insertError;
    }
  }
}

async function clearShowcaseRows(client, manifest) {
  await deleteByIds(
    client,
    "project_collaboration_settlement_items",
    manifest.collaborationSettlementItemIds,
  );
  await deleteByIds(
    client,
    "project_collaboration_settlement_batches",
    manifest.collaborationSettlementBatchIds,
  );
  await deleteByIds(
    client,
    "project_collaboration_revenue_records",
    manifest.collaborationRevenueRecordIds,
  );
  await deleteByIds(
    client,
    "project_collaboration_agreements",
    manifest.collaborationAgreementIds,
  );
  await deleteByIds(
    client,
    "project_collaboration_applications",
    manifest.collaborationApplicationIds,
  );
  await deleteByIds(
    client,
    "project_collaboration_shares",
    manifest.collaborationShareIds,
  );
  await deleteByIds(
    client,
    "settlement_batch_items",
    manifest.settlementBatchItemIds,
  );
  await deleteByIds(client, "settlement_batches", manifest.settlementBatchIds);
  await deleteByIds(client, "review_samples", manifest.reviewSampleIds);
  await deleteByIds(client, "report_change_logs", manifest.reportChangeLogIds);
  await deleteByIds(client, "ocr_results", manifest.ocrResultIds);
  await deleteByIds(client, "report_screenshots", manifest.screenshotIds);
  await deleteByIds(client, "live_reports", manifest.liveReportIds);
  await deleteByIds(client, "live_tasks", manifest.liveTaskIds);
  await deleteByIds(
    client,
    "recording_submissions",
    manifest.recordingSubmissionIds,
  );
  await deleteByIds(
    client,
    "project_applications",
    manifest.projectApplicationIds,
  );
  await deleteByIds(client, "project_streamers", manifest.projectStreamerIds);
  await deleteByIds(client, "streamer_suppliers", manifest.streamerSupplierIds);
  await deleteByIds(client, "streamer_accounts", manifest.streamerAccountIds);
  await deleteByIds(client, "streamers", manifest.streamerIds);
  await deleteByIds(client, "notifications", manifest.notificationIds);
  await deleteByIds(client, "auto_review_rules", manifest.autoReviewRuleIds);
  await deleteByIds(client, "usage_addons", manifest.usageAddonIds);
  await deleteByIds(client, "usage_events", manifest.usageEventIds);
  await deleteByIds(client, "usage_monthly_counters", manifest.usageCounterIds);
  await deleteByIds(client, "organization_subscriptions", [
    manifest.organizationSubscriptionId,
  ]);
  await deleteByIds(client, "projects", manifest.projectIds);
  await deleteByIds(client, "suppliers", manifest.supplierIds);
  await deleteByIds(client, "organizations", [manifest.partnerOrganizationId]);
}

async function insertShowcaseRows(client, rows) {
  await upsertOne(client, "billing_plans", rows.billingPlan);
  await upsertOne(client, "organizations", rows.partnerOrganization);
  await upsertMany(client, "suppliers", rows.suppliers);
  await upsertMany(client, "projects", rows.projects);
  await upsertMany(client, "streamers", rows.streamers);
  await upsertMany(client, "streamer_accounts", rows.streamerAccounts);
  await upsertMany(client, "streamer_suppliers", rows.streamerSuppliers);
  await upsertMany(client, "project_streamers", rows.projectStreamers);
  await upsertMany(client, "project_applications", rows.projectApplications);
  await upsertMany(client, "recording_submissions", rows.recordingSubmissions);
  await upsertMany(client, "live_tasks", rows.liveTasks);
  await upsertMany(client, "live_reports", rows.liveReports);
  await upsertMany(client, "report_screenshots", rows.reportScreenshots);
  await upsertMany(client, "ocr_results", rows.ocrResults);
  await upsertMany(client, "report_change_logs", rows.reportChangeLogs);
  await upsertMany(client, "auto_review_rules", rows.autoReviewRules);
  await upsertMany(client, "review_samples", rows.reviewSamples);
  await upsertMany(client, "settlement_batches", rows.settlementBatches);
  await upsertMany(client, "settlement_batch_items", rows.settlementBatchItems);
  await upsertMany(
    client,
    "project_collaboration_shares",
    rows.projectCollaborationShares,
  );
  await upsertMany(
    client,
    "project_collaboration_applications",
    rows.projectCollaborationApplications,
  );
  await upsertMany(
    client,
    "project_collaboration_agreements",
    rows.projectCollaborationAgreements,
  );
  await upsertMany(
    client,
    "project_collaboration_revenue_records",
    rows.projectCollaborationRevenueRecords,
  );
  await upsertMany(
    client,
    "project_collaboration_settlement_batches",
    rows.projectCollaborationSettlementBatches,
  );
  await upsertMany(
    client,
    "project_collaboration_settlement_items",
    rows.projectCollaborationSettlementItems,
  );
  await upsertMany(client, "notifications", rows.notifications);
  await upsertShowcaseSubscription(client, rows.organizationSubscription);
  await upsertMany(client, "usage_events", rows.usageEvents);
  await upsertShowcaseCounters(client, rows.usageMonthlyCounters);
  await upsertMany(client, "usage_addons", rows.usageAddons);
}

async function summarizeShowcaseRows(client, manifest, targetAccount) {
  return {
    dataset: manifest.datasetCode,
    organizationId: manifest.organizationId,
    targetAccountId: targetAccount.id,
    targetAccount:
      targetAccount.email ?? targetAccount.login_account ?? targetAccount.id,
    projects: await countByIds(client, "projects", manifest.projectIds),
    streamers: await countByIds(client, "streamers", manifest.streamerIds),
    liveTasks: await countByIds(client, "live_tasks", manifest.liveTaskIds),
    liveReports: await countByIds(
      client,
      "live_reports",
      manifest.liveReportIds,
    ),
    applications: await countByIds(
      client,
      "project_applications",
      manifest.projectApplicationIds,
    ),
    settlementBatches: await countByIds(
      client,
      "settlement_batches",
      manifest.settlementBatchIds,
    ),
    collaborationAgreements: await countByIds(
      client,
      "project_collaboration_agreements",
      manifest.collaborationAgreementIds,
    ),
    notifications: await countByIds(
      client,
      "notifications",
      manifest.notificationIds,
    ),
  };
}

async function upsertOne(client, table, row) {
  const { error } = await client.from(table).upsert(row, { onConflict: "id" });
  if (error) {
    throw error;
  }
}

async function upsertMany(client, table, rows) {
  if (!rows?.length) {
    return;
  }

  const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
  if (error) {
    throw error;
  }
}

async function upsertShowcaseSubscription(client, row) {
  const { data, error } = await client
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (data && data.id !== row.id) {
    return;
  }
  await upsertOne(client, "organization_subscriptions", row);
}

async function upsertShowcaseCounters(client, rows) {
  for (const row of rows) {
    const { data, error } = await client
      .from("usage_monthly_counters")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("metric", row.metric)
      .eq("period_month", row.period_month)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data && data.id !== row.id) {
      continue;
    }
    await upsertOne(client, "usage_monthly_counters", row);
  }
}

async function deleteByIds(client, table, ids) {
  if (!ids?.length) {
    return;
  }

  const { error } = await client.from(table).delete().in("id", ids);
  if (error) {
    throw error;
  }
}

async function countByIds(client, table, ids) {
  if (!ids?.length) {
    return 0;
  }

  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .in("id", ids);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

function parseCliArgs(argv) {
  const args = [...argv];
  const command = ["load", "verify", "clear"].includes(args[0])
    ? args.shift()
    : "verify";
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--account") {
      options.account = args[++index];
      continue;
    }
    if (arg.startsWith("--account=")) {
      options.account = arg.slice("--account=".length);
      continue;
    }
    if (arg === "--organization-id") {
      options.organizationId = args[++index];
      continue;
    }
    if (arg.startsWith("--organization-id=")) {
      options.organizationId = arg.slice("--organization-id=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !options.account) {
    throw new Error("Missing required --account option");
  }

  return { command, options };
}

function loadEnv() {
  const loaded = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...valueParts] = trimmed.split("=");
      if (loaded[key] === undefined) {
        loaded[key] = stripOuterQuotes(valueParts.join("="));
      }
    }
  }
  return loaded;
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function displayAccountLabel(account) {
  return account.full_name?.trim() || account.email || account.id.slice(0, 8);
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function stripOuterQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function printSummary(label, summary) {
  console.log(label);
  console.log(JSON.stringify(summary, null, 2));
}

function printHelp() {
  console.log(`Usage:
  pnpm showcase-data:load -- --account <email|login_account|phone|user_id>
  pnpm showcase-data:verify -- --account <email|login_account|phone|user_id>
  pnpm showcase-data:clear -- --account <email|login_account|phone|user_id>

Options:
  --organization-id <uuid>  Use a specific organization instead of the account's first active organization.

Required environment:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  ALLOW_PRODUCT_SHOWCASE_DATA=1`);
}
