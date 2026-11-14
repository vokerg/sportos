import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publicEnvironment, auditFiles } from "./altstore-release.mjs";
const config = {
  EXPO_PUBLIC_SPORTOS_API_URL: "https://api.example.test",
  EXPO_PUBLIC_SPORTOS_WEB_ORIGIN: "https://app.example.test",
};
test("only reviewed public origins and tool environment reach bundling", () => {
  const env = publicEnvironment(config, {
    PATH: "/bin",
    SECRET_KEY: "private",
    DATABASE_URL: "private",
  });
  assert.equal(env.SECRET_KEY, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.EXPO_NO_DOTENV, "1");
  assert.equal(env.SPORTOS_MOBILE_RELEASE, "true");
  for (const bad of [
    "http://localhost:3010",
    "https://user:password@api.example.test",
    "https://api.example.test/path",
    "",
  ])
    assert.throws(() =>
      publicEnvironment({ ...config, EXPO_PUBLIC_SPORTOS_API_URL: bad }, {}),
    );
  assert.throws(() =>
    publicEnvironment(
      { ...config, EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST: "true" },
      {},
    ),
  );
  assert.throws(() =>
    publicEnvironment(config, { EXPO_PUBLIC_SECRET: "private" }),
  );
});
test("payload audit rejects credentials, service files and symlinks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sportos-payload-"));
  try {
    writeFileSync(path.join(dir, "main.jsbundle"), "public code");
    auditFiles(dir);
    for (const name of [
      ".env",
      ".env.local",
      "private.key",
      "source.map",
      "data.sqlite",
    ]) {
      const f = path.join(dir, name);
      writeFileSync(f, "test");
      assert.throws(() => auditFiles(dir));
      rmSync(f);
    }
    const f = path.join(dir, "asset.txt");
    writeFileSync(f, "-----BEGIN PRIVATE KEY-----");
    assert.throws(() => auditFiles(dir));
    rmSync(f);
    mkdirSync(path.join(dir, "nested"));
    symlinkSync("../main.jsbundle", path.join(dir, "nested/link"));
    assert.throws(() => auditFiles(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
