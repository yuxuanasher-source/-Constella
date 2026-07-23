import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HermesSkillSigningKey = {
  readonly keyId: string;
  readonly publicKeyPem: string;
  toJSON(): { keyId: string; publicKeyPem: string };
};

type EnvLike = {
  [key: string]: string | undefined;
  XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY?: string;
  XINGYAO_HERMES_SKILL_SIGNING_PUBLIC_KEY?: string;
  XINGYAO_HERMES_SKILL_SIGNING_KEY_ID?: string;
};

const privateKeys = new WeakMap<HermesSkillSigningKey, KeyObject>();

export function canonicalHermesSkillManifest(manifest: unknown): string {
  return canonicalJson(assertJsonValue(manifest));
}

export function loadHermesSkillSigningKeyFromEnv(
  env: EnvLike = process.env,
): HermesSkillSigningKey {
  const keyId = env.XINGYAO_HERMES_SKILL_SIGNING_KEY_ID?.trim();
  const privateKeyPem = env.XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY;
  if (!keyId || !privateKeyPem) {
    throw new Error("Hermes Skill signing key is not configured");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  requireEd25519Key(privateKey, "Hermes Skill signing private key");
  const publicKeyPem = createPublicKey(privateKey).export({
    type: "spki",
    format: "pem",
  }) as string;
  const key: HermesSkillSigningKey = Object.freeze({
    keyId,
    publicKeyPem,
    toJSON() {
      return { keyId, publicKeyPem };
    },
  });
  privateKeys.set(key, privateKey);
  return key;
}

export function getHermesSkillSigningPublicKeysFromEnv(
  env: EnvLike = process.env,
): Array<{ keyId: string; publicKeyPem: string }> {
  const publicOnly = getHermesSkillSigningPublicKeysFromPublicEnv(env);
  if (publicOnly.length) return publicOnly;
  try {
    const key = loadHermesSkillSigningKeyFromEnv(env);
    return [{ keyId: key.keyId, publicKeyPem: key.publicKeyPem }];
  } catch {
    return [];
  }
}

export function getHermesSkillSigningPublicKeysFromPublicEnv(
  env: EnvLike = process.env,
): Array<{ keyId: string; publicKeyPem: string }> {
  const keyId = env.XINGYAO_HERMES_SKILL_SIGNING_KEY_ID?.trim();
  const publicKeyPem = env.XINGYAO_HERMES_SKILL_SIGNING_PUBLIC_KEY?.trim();
  if (keyId && publicKeyPem) {
    try {
      requireEd25519Key(
        createPublicKey(publicKeyPem),
        "Hermes Skill signing public key",
      );
      return [{ keyId, publicKeyPem }];
    } catch {
      return [];
    }
  }
  return [];
}

export function signHermesSkillApproval({
  manifest,
  bundleSha256,
  signingKey,
}: {
  manifest: unknown;
  bundleSha256: string;
  signingKey: HermesSkillSigningKey;
}): { signingKeyId: string; signature: string } {
  if (!isSha256(bundleSha256)) {
    throw new Error("Invalid Hermes Skill bundle hash");
  }
  const privateKey = privateKeys.get(signingKey);
  if (!privateKey) {
    throw new Error("Invalid Hermes Skill signing key");
  }
  requireEd25519Key(privateKey, "Hermes Skill signing private key");
  const payload = skillApprovalPayload({
    manifest,
    bundleSha256,
    signingKeyId: signingKey.keyId,
  });
  return {
    signingKeyId: signingKey.keyId,
    signature: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
      "base64url",
    ),
  };
}

export function verifyHermesSkillApproval({
  manifest,
  bundleSha256,
  signingKeyId,
  signature,
  publicKeys,
}: {
  manifest: unknown;
  bundleSha256: string;
  signingKeyId: string;
  signature: string;
  publicKeys: Record<string, string>;
}): boolean {
  try {
    if (!isSha256(bundleSha256) || !signature || !signingKeyId) return false;
    const publicKeyPem = publicKeys[signingKeyId];
    if (!publicKeyPem) return false;
    const publicKey = createPublicKey(publicKeyPem);
    requireEd25519Key(publicKey, "Hermes Skill signing public key");
    const payload = skillApprovalPayload({
      manifest,
      bundleSha256,
      signingKeyId,
    });
    return verify(
      null,
      Buffer.from(payload, "utf8"),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function hermesSkillSigningPublicKeysToRecord(
  publicKeys: readonly { keyId: string; publicKeyPem: string }[],
): Record<string, string> {
  return Object.fromEntries(
    publicKeys
      .filter((key) => key.keyId && key.publicKeyPem)
      .map((key) => [key.keyId, key.publicKeyPem]),
  );
}

function skillApprovalPayload(input: {
  manifest: unknown;
  bundleSha256: string;
  signingKeyId: string;
}): string {
  return canonicalJson({
    bundleSha256: input.bundleSha256.toLowerCase(),
    keyId: input.signingKeyId,
    manifest: assertJsonValue(input.manifest),
  });
}

function canonicalJson(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function assertJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid JSON value");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(assertJsonValue);
  }
  if (!isPlainRecord(value)) throw new Error("Invalid JSON value");
  const copy: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPrototypeKey(key)) throw new Error("Invalid JSON key");
    copy[key] = assertJsonValue(item);
  }
  return copy;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function requireEd25519Key(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} must be Ed25519`);
  }
}

function isPrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
