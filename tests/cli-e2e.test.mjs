import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { spawn } from "node:child_process";

const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7nKsAAAAASUVORK5CYII=";

async function copyWorkspace(sourceDir) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ephex-cli-e2e-"));
  const targetDir = path.join(tempRoot, "workspace");
  const excluded = new Set([
    ".git",
    ".wrangler",
    ".tmp-config",
    ".tmp-cache",
    ".env",
    "image.png",
    "output.png",
    "ephex-private.pem",
    "ephex-public.pem",
  ]);

  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => {
      const relative = path.relative(sourceDir, src);
      if (!relative) return true;
      const firstSegment = relative.split(path.sep)[0];
      return !excluded.has(firstSegment);
    },
  });

  return { tempRoot, targetDir };
}

function spawnProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/profile`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the dev server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for wrangler dev");
}

function parseSetCookie(setCookie) {
  return String(setCookie || "").split(";")[0];
}

async function loginAndGetProfile(baseUrl) {
  const loginForm = new FormData();
  loginForm.append("username", "admin");
  loginForm.append("password", "admin-pass");

  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    body: loginForm,
  });
  assert.equal(loginResponse.status, 200);

  const cookie = parseSetCookie(loginResponse.headers.get("set-cookie"));
  assert.match(cookie, /^token=/);

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    headers: { Cookie: cookie },
  });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.authenticated, true);
  assert.ok(profile.api_token);

  return { cookie, profile };
}

function startWranglerDev(workdir, homeDir, port) {
  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(workdir, ".tmp-config"),
    XDG_CACHE_HOME: path.join(workdir, ".tmp-cache"),
  };

  const child = spawn("zsh", ["-lc", `wrangler dev --ip 127.0.0.1 --port ${port}`], {
    cwd: workdir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { child, outputRef: () => output, env };
}

async function runNodeScript(workdir, args, extraEnv = {}) {
  return spawnProcess(process.execPath, args, {
    cwd: workdir,
    env: { ...process.env, ...extraEnv },
  });
}

test("CLI upload/download e2e", async (t) => {
  const sourceDir = "/Users/beomsu/wrkp/ephex/ephex-server";
  const { tempRoot, targetDir } = await copyWorkspace(sourceDir);
  const homeDir = path.join(tempRoot, "home");
  const configDir = path.join(homeDir, ".config", "ephex");
  const fixturePath = path.join(targetDir, "tests", "fixture.png");
  const plainOut = path.join(targetDir, "tests", "plain-out.png");
  const symmetricOut = path.join(targetDir, "tests", "symmetric-out.png");
  const port = 8976;
  const baseUrl = `http://127.0.0.1:${port}`;

  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(targetDir, ".dev.vars"), "JWT_SECRET=test-secret\n");
  await writeFile(fixturePath, Buffer.from(FIXTURE_PNG_BASE64, "base64"));

  const dbInit = await spawnProcess("zsh", ["-lc", "wrangler d1 execute ephex-db --local --file=schema.sql"], {
    cwd: targetDir,
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: path.join(targetDir, ".tmp-config"),
      XDG_CACHE_HOME: path.join(targetDir, ".tmp-cache"),
    },
  });
  assert.equal(dbInit.code, 0, dbInit.stderr || dbInit.stdout);

  const { child: devServer, outputRef } = startWranglerDev(targetDir, homeDir, port);
  t.after(async () => {
    devServer.kill("SIGTERM");
    await rm(tempRoot, { recursive: true, force: true });
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    throw new Error(`${error.message}\n${outputRef()}`);
  }

  const { profile } = await loginAndGetProfile(baseUrl);
  const apiToken = profile.api_token;

  await t.test("plain upload/download via env", async () => {
    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", fixturePath],
      {
        HOME: homeDir,
        EPHEX_BASE_URL: baseUrl,
        EPHEX_API_TOKEN: apiToken,
      }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrl = upload.stdout.trim();
    assert.match(rawUrl, /^http:\/\/127\.0\.0\.1:8976\/img\/.+\.png$/);

    const download = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl, plainOut], {
      HOME: homeDir,
    });
    assert.equal(download.code, 0, download.stderr);
    const downloaded = await readFile(plainOut);
    const original = await readFile(fixturePath);
    assert.deepEqual(downloaded, original);
  });

  await t.test("download limit blocks further access", async () => {
    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", "--downloads", "1", fixturePath],
      {
        HOME: homeDir,
        EPHEX_BASE_URL: baseUrl,
        EPHEX_API_TOKEN: apiToken,
      }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrl = upload.stdout.trim();

    const first = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(first.code, 0, first.stderr);

    const second = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(second.code, 1);
    assert.match(second.stderr, /404|not found|limit reached/i);
  });

  await t.test("expired upload is rejected", async () => {
    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", "--expires", "0.0003", fixturePath],
      {
        HOME: homeDir,
        EPHEX_BASE_URL: baseUrl,
        EPHEX_API_TOKEN: apiToken,
      }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrl = upload.stdout.trim();

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const expired = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(expired.code, 1);
    assert.match(expired.stderr, /404|expired|not found/i);
  });

  await t.test("symmetric upload/download succeeds and missing hash fails", async () => {
    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", "--mode", "symmetric", fixturePath],
      {
        HOME: homeDir,
        EPHEX_BASE_URL: baseUrl,
        EPHEX_API_TOKEN: apiToken,
      }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrlWithKey = upload.stdout.trim();
    assert.match(rawUrlWithKey, /^http:\/\/127\.0\.0\.1:8976\/img\/.+\.enc#/);

    const download = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrlWithKey, symmetricOut], {
      HOME: homeDir,
    });
    assert.equal(download.code, 0, download.stderr);
    const downloaded = await readFile(symmetricOut);
    const original = await readFile(fixturePath);
    assert.deepEqual(downloaded, original);

    const withoutKey = rawUrlWithKey.split("#")[0];
    const failed = await runNodeScript(targetDir, ["bin/ephex-download.js", withoutKey], {
      HOME: homeDir,
    });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /missing a decryption key/i);
  });

  await t.test("public-key upload/download via ~/.config/ephex/env", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 4096,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const privateKeyPath = path.join(configDir, "private.pem");
    const publicKeyPath = path.join(configDir, "public.pem");
    const downloadDir = path.join(homeDir, "Downloads", "ephex");
    await writeFile(privateKeyPath, privateKey);
    await writeFile(publicKeyPath, publicKey);
    await chmod(privateKeyPath, 0o600);
    await writeFile(
      path.join(configDir, "env"),
      [
        `EPHEX_BASE_URL=${baseUrl}`,
        `EPHEX_API_TOKEN=${apiToken}`,
        `EPHEX_PUBLIC_KEY=${publicKeyPath}`,
        `EPHEX_PRIVATE_KEY=${privateKeyPath}`,
        `EPHEX_DOWNLOAD_DIR=${downloadDir}`,
        "EPHEX_OVERWRITE_MODE=suffix",
        "",
      ].join("\n")
    );

    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", "--mode", "public-key", fixturePath],
      { HOME: homeDir }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrl = upload.stdout.trim();
    assert.match(rawUrl, /^http:\/\/127\.0\.0\.1:8976\/img\/.+\.enc$/);

    const firstDownload = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(firstDownload.code, 0, firstDownload.stderr);
    const firstPath = firstDownload.stdout.trim();
    assert.match(firstPath, /fixture\.png$/);

    const secondDownload = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(secondDownload.code, 0, secondDownload.stderr);
    const secondPath = secondDownload.stdout.trim();
    assert.match(secondPath, /fixture-2\.png$/);

    const original = await readFile(fixturePath);
    const firstData = await readFile(firstPath);
    const secondData = await readFile(secondPath);
    assert.deepEqual(firstData, original);
    assert.deepEqual(secondData, original);
  });

  await t.test("public-key download fails on open private key permissions", async () => {
    const envPath = path.join(configDir, "env");
    const envContents = await readFile(envPath, "utf8");
    const privateKeyPath = envContents
      .split("\n")
      .find((line) => line.startsWith("EPHEX_PRIVATE_KEY="))
      ?.split("=")[1];
    assert.ok(privateKeyPath);
    await chmod(privateKeyPath, 0o644);

    const upload = await runNodeScript(
      targetDir,
      ["bin/ephex-upload.js", "--mode", "public-key", fixturePath],
      { HOME: homeDir }
    );
    assert.equal(upload.code, 0, upload.stderr);
    const rawUrl = upload.stdout.trim();

    const failed = await runNodeScript(targetDir, ["bin/ephex-download.js", rawUrl], {
      HOME: homeDir,
    });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /permissions are too open/i);
    await chmod(privateKeyPath, 0o600);
  });
});
