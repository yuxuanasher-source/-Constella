import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isHermesAuthRole,
  isHermesReadScope,
  isSha256,
  isUuid,
  type HermesAuthRole,
  type HermesReadScope,
  type HermesSkillGrant,
} from "./contracts";
import { verifyHermesSkillApproval } from "./skill-signing";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024;
const SCRIPT_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".cjs",
  ".exe",
  ".js",
  ".mjs",
  ".node",
  ".ps1",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".wasm",
]);

export type HermesBuiltinApprovedSkill = {
  skillId: string;
  version: string;
  bundleSha256: string;
  displayName: string;
  description: string;
  requiredReadScopes: readonly HermesReadScope[];
  allowedRoles: readonly HermesAuthRole[];
  artifactPath: string;
  source: "builtin";
  status: "approved";
  signingKeyId: "code-owned";
  signature: string;
};

export const HERMES_BUILTIN_APPROVED_SKILLS = [
  {
    skillId: "business-context",
    version: "1.0.0",
    bundleSha256:
      "731ebee4b861002857d52f16c22780f0a05959c03f03aa85d7b093053d045fea",
    displayName: "Business Context",
    description: "Read-only business context summarization for the current actor.",
    requiredReadScopes: ["context.read"],
    allowedRoles: [
      "owner",
      "ops_manager",
      "operator_business",
      "finance",
      "streamer",
    ],
    artifactPath: "builtin-skills/business-context/SKILL.md",
    source: "builtin",
    status: "approved",
    signingKeyId: "code-owned",
    signature: "code-owned:731ebee4b861002857d52f16c22780f0a05959c03f03aa85d7b093053d045fea",
  },
  {
    skillId: "project-review",
    version: "1.0.0",
    bundleSha256:
      "ddeccbc63ea892a820279fd5adef23f151a750f68bee14cab8289b83f6744918",
    displayName: "Project Review",
    description: "Read-only project, streamer, live report and review analysis.",
    requiredReadScopes: [
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
    ],
    allowedRoles: ["owner", "ops_manager", "operator_business", "streamer"],
    artifactPath: "builtin-skills/project-review/SKILL.md",
    source: "builtin",
    status: "approved",
    signingKeyId: "code-owned",
    signature: "code-owned:ddeccbc63ea892a820279fd5adef23f151a750f68bee14cab8289b83f6744918",
  },
  {
    skillId: "report-precheck",
    version: "1.0.0",
    bundleSha256:
      "1863892faf70394e318c15dc0eb54a1ceab15d99579864a911c24578eae774fd",
    displayName: "Report Precheck",
    description: "Read-only live report and recording review precheck.",
    requiredReadScopes: [
      "projects.summary",
      "live_reports.search",
      "recording_reviews.search",
    ],
    allowedRoles: ["owner", "ops_manager", "operator_business", "streamer"],
    artifactPath: "builtin-skills/report-precheck/SKILL.md",
    source: "builtin",
    status: "approved",
    signingKeyId: "code-owned",
    signature: "code-owned:1863892faf70394e318c15dc0eb54a1ceab15d99579864a911c24578eae774fd",
  },
  {
    skillId: "settlement-analysis",
    version: "1.0.0",
    bundleSha256:
      "31091766970205b93c59043ff47960e9899fdf90693736c66af5480367cab300",
    displayName: "Settlement Analysis",
    description: "Read-only settlement summary analysis.",
    requiredReadScopes: ["settlements.summary"],
    allowedRoles: [
      "owner",
      "ops_manager",
      "operator_business",
      "finance",
      "streamer",
    ],
    artifactPath: "builtin-skills/settlement-analysis/SKILL.md",
    source: "builtin",
    status: "approved",
    signingKeyId: "code-owned",
    signature: "code-owned:31091766970205b93c59043ff47960e9899fdf90693736c66af5480367cab300",
  },
] as const satisfies readonly HermesBuiltinApprovedSkill[];

export type HermesBuiltinSkillArtifact = HermesBuiltinApprovedSkill & {
  bundle: string;
  sizeBytes: number;
};

export type HermesSkillDraftApprovalRow = {
  id: unknown;
  organization_id: unknown;
  owner_user_id: unknown;
  skill_id: unknown;
  version: unknown;
  manifest: unknown;
  bundle: unknown;
  bundle_sha256: unknown;
  status: unknown;
  signing_key_id: unknown;
  signature: unknown;
};

export type HermesApprovedSkillDraftArtifact = {
  skillId: string;
  version: string;
  bundle: string;
  bundleSha256: string;
  source: "draft";
};

export type HermesSkillDraftRegistryClient = {
  from(table: "ai_hermes_skill_drafts"): {
    select(columns: string): HermesSkillDraftRegistryQuery;
  };
};

type HermesSkillDraftRegistryQuery = {
  eq(column: string, value: unknown): HermesSkillDraftRegistryQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

type ActorGrantInput = {
  organizationId: string;
  userId: string;
  role: HermesAuthRole;
  allowedReadScopes: readonly HermesReadScope[];
};

export function computeHermesSkillBundleSha256(bundle: string): string {
  return createHash("sha256").update(bundle, "utf8").digest("hex");
}

export function getHermesBuiltinSkillArtifacts(
  cwd = process.cwd(),
): HermesBuiltinSkillArtifact[] {
  return HERMES_BUILTIN_APPROVED_SKILLS.map((skill) => {
    const fullPath = path.join(
      cwd,
      "features",
      "ai",
      "hermes",
      skill.artifactPath,
    );
    const bundle = readFileSync(fullPath, "utf8");
    const actualHash = computeHermesSkillBundleSha256(bundle);
    if (actualHash !== skill.bundleSha256) {
      throw new Error(`Hermes builtin Skill hash mismatch: ${skill.skillId}`);
    }
    return { ...skill, bundle, sizeBytes: Buffer.byteLength(bundle, "utf8") };
  });
}

export function getHermesBuiltinSkillArtifact(
  skillId: string,
): HermesBuiltinSkillArtifact | null {
  return (
    getHermesBuiltinSkillArtifacts().find((skill) => skill.skillId === skillId) ??
    null
  );
}

export function validateHermesSkillBundle(
  bundle: string,
  expectedSha256?: string,
):
  | { ok: true; files: Array<{ path: string; sha256: string; sizeBytes: number }> }
  | { ok: false; reason: string } {
  if (typeof bundle !== "string" || !bundle.trim()) {
    return { ok: false, reason: "empty_bundle" };
  }
  if (Buffer.byteLength(bundle, "utf8") > MAX_BUNDLE_BYTES) {
    return { ok: false, reason: "bundle_oversize" };
  }
  if (expectedSha256 && computeHermesSkillBundleSha256(bundle) !== expectedSha256) {
    return { ok: false, reason: "hash_mismatch" };
  }

  const parsed = parseBundleFiles(bundle);
  if (!parsed.ok) return parsed;

  const seen = new Set<string>();
  for (const file of parsed.files) {
    const normalized = normalizeBundlePath(file.path);
    if (!normalized) return { ok: false, reason: "unsafe_path" };
    if (seen.has(normalized)) return { ok: false, reason: "duplicate_path" };
    seen.add(normalized);
    if (file.type && file.type !== "file") {
      return { ok: false, reason: "unsafe_link" };
    }
    if (isExecutableMode(file.mode) || isForbiddenFilePath(normalized)) {
      return { ok: false, reason: "executable_or_dynamic_content" };
    }
    if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
      return { ok: false, reason: "file_oversize" };
    }
    if (containsForbiddenEnvRef(file.content)) {
      return { ok: false, reason: "env_ref" };
    }
  }
  return {
    ok: true,
    files: parsed.files.map((file) => ({
      path: normalizeBundlePath(file.path) ?? file.path,
      sha256: computeHermesSkillBundleSha256(file.content),
      sizeBytes: Buffer.byteLength(file.content, "utf8"),
    })),
  };
}

export function resolveApprovedHermesSkillGrantsForActor({
  actor,
  rows,
  publicKeys,
}: {
  actor: ActorGrantInput;
  rows: readonly HermesSkillDraftApprovalRow[];
  publicKeys: Record<string, string>;
}): Array<HermesSkillGrant & { draftId: string }> {
  const readScopes = new Set(actor.allowedReadScopes);
  const grants: Array<HermesSkillGrant & { draftId: string }> = [];
  for (const row of rows) {
    const grant = approvedRowToGrant(row, actor, readScopes, publicKeys);
    if (grant) grants.push(grant);
  }
  return grants.sort((left, right) => compareAscii(left.skillId, right.skillId));
}

export async function loadHermesSkillDraftApprovalRowsForActor({
  client,
  actor,
}: {
  client: HermesSkillDraftRegistryClient;
  actor: { organizationId: string; userId: string };
}): Promise<HermesSkillDraftApprovalRow[]> {
  try {
    const result = await client
      .from("ai_hermes_skill_drafts")
      .select(
        "id, organization_id, owner_user_id, skill_id, version, manifest, bundle, bundle_sha256, status, signing_key_id, signature",
      )
      .eq("organization_id", actor.organizationId)
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });
    if (result.error || !Array.isArray(result.data)) return [];
    return result.data.filter(isHermesSkillDraftApprovalRow);
  } catch {
    return [];
  }
}

export function resolveApprovedHermesSkillArtifactForActor({
  actor,
  rows,
  publicKeys,
  skillId,
}: {
  actor: ActorGrantInput;
  rows: readonly HermesSkillDraftApprovalRow[];
  publicKeys: Record<string, string>;
  skillId: string;
}): HermesApprovedSkillDraftArtifact | null {
  for (const row of rows) {
    if (row.skill_id !== skillId) continue;
    const grant = approvedRowToGrant(
      row,
      actor,
      new Set(actor.allowedReadScopes),
      publicKeys,
    );
    if (!grant || typeof row.bundle !== "string") continue;
    return {
      skillId: grant.skillId,
      version: grant.version,
      bundle: row.bundle,
      bundleSha256: grant.bundleSha256,
      source: "draft",
    };
  }
  return null;
}

function approvedRowToGrant(
  row: HermesSkillDraftApprovalRow,
  actor: ActorGrantInput,
  readScopes: ReadonlySet<HermesReadScope>,
  publicKeys: Record<string, string>,
): (HermesSkillGrant & { draftId: string }) | null {
  if (
    row.status !== "approved" ||
    !isUuid(row.id) ||
    row.organization_id !== actor.organizationId ||
    row.owner_user_id !== actor.userId ||
    typeof row.skill_id !== "string" ||
    typeof row.bundle !== "string" ||
    !isSha256(row.bundle_sha256) ||
    typeof row.signing_key_id !== "string" ||
    typeof row.signature !== "string"
  ) {
    return null;
  }
  if (
    validateHermesSkillBundle(row.bundle, row.bundle_sha256.toLowerCase()).ok !==
    true
  ) {
    return null;
  }
  const manifest = parseApprovedManifest(row.manifest);
  if (!manifest || manifest.skillId !== row.skill_id) return null;
  if (!manifest.allowedRoles.includes(actor.role)) return null;
  if (manifest.requiredReadScopes.some((scope) => !readScopes.has(scope))) {
    return null;
  }
  if (
    !verifyHermesSkillApproval({
      manifest: row.manifest,
      bundleSha256: row.bundle_sha256.toLowerCase(),
      signingKeyId: row.signing_key_id,
      signature: row.signature,
      publicKeys,
    })
  ) {
    return null;
  }
  return {
    draftId: row.id,
    skillId: manifest.skillId,
    version: manifest.version,
    bundleSha256: row.bundle_sha256.toLowerCase(),
  };
}

function isHermesSkillDraftApprovalRow(
  value: unknown,
): value is HermesSkillDraftApprovalRow {
  return (
    isPlainRecord(value) &&
    Object.hasOwn(value, "id") &&
    Object.hasOwn(value, "organization_id") &&
    Object.hasOwn(value, "owner_user_id") &&
    Object.hasOwn(value, "skill_id") &&
    Object.hasOwn(value, "version") &&
    Object.hasOwn(value, "manifest") &&
    Object.hasOwn(value, "bundle") &&
    Object.hasOwn(value, "bundle_sha256") &&
    Object.hasOwn(value, "status") &&
    Object.hasOwn(value, "signing_key_id") &&
    Object.hasOwn(value, "signature")
  );
}

function parseApprovedManifest(
  value: unknown,
): {
  skillId: string;
  version: string;
  allowedRoles: HermesAuthRole[];
  requiredReadScopes: HermesReadScope[];
} | null {
  if (!isPlainRecord(value)) return null;
  const { skillId, version, allowedRoles, requiredReadScopes } = value;
  if (
    typeof skillId !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(skillId) ||
    typeof version !== "string" ||
    !/^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)/.test(version) ||
    !Array.isArray(allowedRoles) ||
    !Array.isArray(requiredReadScopes) ||
    !allowedRoles.every(isHermesAuthRole) ||
    !requiredReadScopes.every(isHermesReadScope)
  ) {
    return null;
  }
  return {
    skillId,
    version,
    allowedRoles: [...allowedRoles],
    requiredReadScopes: [...requiredReadScopes],
  };
}

function parseBundleFiles(
  bundle: string,
):
  | {
      ok: true;
      files: Array<{
        path: string;
        content: string;
        type?: string;
        mode?: string | number;
      }>;
    }
  | { ok: false; reason: string } {
  const trimmed = bundle.trimStart();
  if (!trimmed.startsWith("{")) {
    return { ok: true, files: [{ path: "SKILL.md", content: bundle }] };
  }
  try {
    const parsed = JSON.parse(bundle) as unknown;
    if (!isPlainRecord(parsed) || !Array.isArray(parsed.files)) {
      return { ok: false, reason: "invalid_bundle" };
    }
    const files = parsed.files.map((file) => {
      if (
        !isPlainRecord(file) ||
        typeof file.path !== "string" ||
        typeof file.content !== "string"
      ) {
        return null;
      }
      return {
        path: file.path,
        content: file.content,
        type: typeof file.type === "string" ? file.type : undefined,
        mode:
          typeof file.mode === "string" || typeof file.mode === "number"
            ? file.mode
            : undefined,
      };
    });
    if (files.some((file) => file === null)) {
      return { ok: false, reason: "invalid_bundle_file" };
    }
    return {
      ok: true,
      files: files as Array<{
        path: string;
        content: string;
        type?: string;
        mode?: string | number;
      }>,
    };
  } catch {
    return { ok: false, reason: "invalid_bundle_json" };
  }
}

function normalizeBundlePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function isForbiddenFilePath(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("scripts/") ||
    lower.includes("/scripts/") ||
    lower === "mcp.json" ||
    lower.endsWith("/mcp.json") ||
    SCRIPT_EXTENSIONS.has(path.posix.extname(lower))
  );
}

function isExecutableMode(mode: unknown): boolean {
  if (mode === undefined) return false;
  const text = String(mode);
  const parsed = Number.parseInt(text.replace(/^0o/, ""), 8);
  return Number.isFinite(parsed) && (parsed & 0o111) !== 0;
}

function containsForbiddenEnvRef(content: string): boolean {
  return /\bprocess\.env\b|\$\{[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PRIVATE)[A-Z0-9_]*\}/.test(
    content,
  );
}

function compareAscii(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
