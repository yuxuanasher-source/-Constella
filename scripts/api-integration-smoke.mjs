import { existsSync, readFileSync } from "node:fs";

import { createServerClient } from "@supabase/ssr";

const projectId = "99999999-9999-9999-9999-999999999999";
const seededBatchId = "95959595-9595-4959-9595-959595959595";
const password = "Password123!";

const forbiddenDtoKeyPatterns = [
  /_/,
  /receivable/i,
  /gross/i,
  /cost/i,
  /vendorPrice/i,
  /vendorUnitPrice/i,
  /supplierPrice/i,
];

const env = loadEnv();
const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const opsCookie = await signIn("ops@jy-demo.local");
const financeCookie = await signIn("finance@jy-demo.local");
const streamerCookie = await signIn("streamer@jy-demo.local");

await check("ops can read the M5 report queue over HTTP", async () => {
  const body = await requestJson("/api/live-reports", {
    cookie: opsCookie,
  });

  assertArray(body.reports, "reports");
  assertNonEmpty(body.reports, "reports");
  assertPublicDtoShape(body.reports, "reports");
  assertNotContains(JSON.stringify(body.reports), /amount/i, "reports");
});

await check("ops can read the M6 settlement pool over HTTP", async () => {
  const body = await requestJson(
    `/api/settlement-pool?projectId=${projectId}&periodStart=2026-01-01&periodEnd=2026-12-31`,
    { cookie: opsCookie },
  );

  assertArray(body.reports, "settlement pool reports");
  assertNonEmpty(body.reports, "settlement pool reports");
  assertPublicDtoShape(body.reports, "settlement pool reports");
});

await check(
  "ops can read M6 settlement batches and details over HTTP",
  async () => {
    const listBody = await requestJson("/api/settlement-batches", {
      cookie: opsCookie,
    });
    assertArray(listBody.batches, "settlement batches");
    assertNonEmpty(listBody.batches, "settlement batches");
    assertPublicDtoShape(listBody.batches, "settlement batches");

    const detailBody = await requestJson(
      `/api/settlement-batches/${seededBatchId}`,
      { cookie: opsCookie },
    );
    assertObject(detailBody.batch, "settlement batch detail");
    assertArray(detailBody.items, "settlement batch detail items");
    assertNonEmpty(detailBody.items, "settlement batch detail items");
    assertPublicDtoShape(detailBody, "settlement batch detail");
  },
);

await check(
  "streamer can read payable-safe settlements over HTTP",
  async () => {
    const body = await requestJson("/api/streamer/settlements", {
      cookie: streamerCookie,
    });

    assertObject(body.earnings, "streamer earnings");
    assertArray(body.earnings.items, "streamer earnings items");
    assertNonEmpty(body.earnings.items, "streamer earnings items");
    assertPublicDtoShape(body.earnings, "streamer earnings");
  },
);

await check(
  "finance receives 403 for M6 settlement mutations over HTTP",
  async () => {
    const body = await requestJson("/api/settlement-batches", {
      cookie: financeCookie,
      method: "POST",
      expectedStatus: 403,
      body: {
        projectId,
        batchType: "payable",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      },
    });

    assertEqual(
      body.error,
      "Current role cannot manage settlement batches",
      "finance mutation error",
    );
  },
);

console.log("api integration smoke passed");

async function signIn(email) {
  const jar = new Map();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          if (value) {
            jar.set(name, value);
          } else {
            jar.delete(name);
          }
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(`Could not sign in ${email}: ${error.message}`);
  }

  const cookie = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!cookie) {
    throw new Error(`No Supabase SSR cookie was created for ${email}`);
  }

  return cookie;
}

async function requestJson(path, options) {
  const response = await fetch(`${appUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Cookie: options.cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  const expectedStatus = options.expectedStatus ?? 200;

  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(
        body,
      )}`,
    );
  }

  return body;
}

async function check(label, fn) {
  await fn();
  console.log(`ok - ${label}`);
}

function loadEnv() {
  const loaded = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) {
      continue;
    }

    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || loaded[match[1]]) {
        continue;
      }

      loaded[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }

  return loaded;
}

function requireEnv(key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required for API integration smoke`);
  }

  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function assertNonEmpty(value, label) {
  if (!value.length) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

function assertNotContains(value, pattern, label) {
  if (pattern.test(value)) {
    throw new Error(`${label} must not contain ${pattern}`);
  }
}

function assertPublicDtoShape(value, label) {
  for (const key of collectObjectKeys(value)) {
    for (const pattern of forbiddenDtoKeyPatterns) {
      if (pattern.test(key)) {
        throw new Error(`${label} contains forbidden DTO key "${key}"`);
      }
    }
  }
}

function collectObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectObjectKeys(nestedValue),
  ]);
}
