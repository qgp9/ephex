#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { webcrypto } from "node:crypto";

function printUsage() {
  console.error("Usage: ephex-upload [options] <file>");
  console.error("Options:");
  console.error("  --server <url>        Worker origin or /api/upload URL");
  console.error("  --token <token>       API token");
  console.error("  --mode <plain|symmetric|public-key>");
  console.error("  --key <base64url>     Symmetric AES key (optional)");
  console.error("  --public-key <value>  Public key PEM or path");
  console.error("  --expires <hours>     Expiration in hours");
  console.error("  --downloads <count>   Max downloads");
}

function expandHome(inputPath) {
  if (!inputPath) return "";
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseDotEnv(contents) {
  const env = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadDotEnvConfig() {
  const envPaths = [
    path.resolve(process.cwd(), ".env"),
    path.join(os.homedir(), ".config", "ephex", "env"),
  ];

  return envPaths.reduce((acc, envPath) => {
    if (!fs.existsSync(envPath)) return acc;
    return { ...acc, ...parseDotEnv(fs.readFileSync(envPath, "utf8")) };
  }, {});
}

function arrayBufferToBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function base64UrlToBuffer(input) {
  return Buffer.from(input, "base64url");
}

function pemToDerBuffer(pem) {
  const normalized = String(pem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("Public key is empty");
  }
  return Buffer.from(normalized, "base64");
}

function resolveUploadUrl(serverValue) {
  if (!serverValue) throw new Error("Missing upload server URL. Use --server or EPHEX_BASE_URL.");
  const url = new URL(serverValue);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/api/upload";
    return url;
  }
  return url;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function readPublicKeyInput(value) {
  if (!value) {
    throw new Error("Missing public key. Use --public-key or EPHEX_PUBLIC_KEY.");
  }

  const expanded = expandHome(value);
  if (fs.existsSync(expanded)) {
    return readFile(expanded, "utf8");
  }

  return value;
}

async function encryptSymmetric(fileBuffer, providedKeyBase64Url = "") {
  let rawKey;
  if (providedKeyBase64Url) {
    rawKey = base64UrlToBuffer(providedKeyBase64Url);
    if (rawKey.length !== 32) {
      throw new Error("Symmetric key must be 32 bytes encoded as base64url");
    }
  } else {
    rawKey = webcrypto.getRandomValues(new Uint8Array(32));
  }

  const key = await webcrypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, fileBuffer);
  const payload = Buffer.concat([Buffer.from(iv), Buffer.from(encryptedBuffer)]);

  return {
    payload,
    keyBase64Url: arrayBufferToBase64Url(rawKey),
  };
}

async function encryptForPublicKey(fileBuffer, publicKeyPem) {
  const symmetric = await encryptSymmetric(fileBuffer);
  const publicKey = await webcrypto.subtle.importKey(
    "spki",
    pemToDerBuffer(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const wrappedKey = await webcrypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    base64UrlToBuffer(symmetric.keyBase64Url)
  );

  return {
    payload: symmetric.payload,
    wrappedKeyBase64: arrayBufferToBase64Url(wrappedKey),
    keyAlgorithm: "RSA-OAEP-256",
  };
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  throw new Error(stripped || `Unexpected ${response.status} response`);
}

async function main() {
  const args = [...process.argv.slice(2)];
  const dotEnv = loadDotEnvConfig();
  const options = {};

  while (args[0]?.startsWith("--")) {
    const flag = args.shift();
    if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }

    const value = args.shift();
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === "--server") options.server = value;
    else if (flag === "--token") options.token = value;
    else if (flag === "--mode") options.mode = value;
    else if (flag === "--key") options.key = value;
    else if (flag === "--public-key") options.publicKey = value;
    else if (flag === "--expires") options.expires = value;
    else if (flag === "--downloads") options.downloads = value;
    else throw new Error(`Unknown option: ${flag}`);
  }

  const inputFile = args[0];
  if (!inputFile) {
    printUsage();
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), inputFile);
  const fileName = path.basename(filePath);
  const fileBuffer = await readFile(filePath);
  const serverValue = options.server || process.env.EPHEX_BASE_URL || dotEnv.EPHEX_BASE_URL || "";
  const uploadUrl = resolveUploadUrl(serverValue);
  const token = options.token || process.env.EPHEX_API_TOKEN || dotEnv.EPHEX_API_TOKEN || "";
  const rawMode = (options.mode || process.env.EPHEX_ENCRYPTION_MODE || dotEnv.EPHEX_ENCRYPTION_MODE || "plain").toLowerCase();
  const mode = rawMode === "public_key" ? "public-key" : rawMode;
  const symmetricKey = options.key || process.env.EPHEX_SYMMETRIC_KEY || dotEnv.EPHEX_SYMMETRIC_KEY || "";
  const publicKeyValue = options.publicKey || process.env.EPHEX_PUBLIC_KEY || dotEnv.EPHEX_PUBLIC_KEY || "";
  const expires = options.expires || process.env.EPHEX_EXPIRES_HOURS || dotEnv.EPHEX_EXPIRES_HOURS || "";
  const downloads = options.downloads || process.env.EPHEX_MAX_DOWNLOADS || dotEnv.EPHEX_MAX_DOWNLOADS || "";

  if (!token) {
    throw new Error("Missing API token. Use --token or EPHEX_API_TOKEN.");
  }

  if (!["plain", "symmetric", "public-key"].includes(mode)) {
    throw new Error("Mode must be one of: plain, symmetric, public-key");
  }

  let uploadBuffer = fileBuffer;
  let outputRawUrlSuffix = "";
  let encryptedKey = "";
  let keyAlgorithm = "";

  if (mode === "symmetric") {
    const result = await encryptSymmetric(fileBuffer, symmetricKey);
    uploadBuffer = result.payload;
    outputRawUrlSuffix = `#${result.keyBase64Url}`;
  } else if (mode === "public-key") {
    const publicKeyPem = await readPublicKeyInput(publicKeyValue);
    const result = await encryptForPublicKey(fileBuffer, publicKeyPem);
    uploadBuffer = result.payload;
    encryptedKey = result.wrappedKeyBase64;
    keyAlgorithm = result.keyAlgorithm;
  }

  const form = new FormData();
  form.append("image", new Blob([uploadBuffer], { type: mode === "plain" ? getMimeType(filePath) : "application/octet-stream" }), fileName);
  form.append("encryption_mode", mode === "public-key" ? "public_key" : mode);
  form.append("is_encrypted", mode === "plain" ? "0" : "1");
  if (expires) form.append("expires_in_hours", expires);
  if (downloads) form.append("max_downloads", downloads);
  if (encryptedKey) form.append("encrypted_key", encryptedKey);
  if (keyAlgorithm) form.append("key_algorithm", keyAlgorithm);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Api-Token": token },
    body: form,
  });
  const data = await parseJsonResponse(response);
  if (!data.success) {
    throw new Error(data.error || "Upload failed");
  }

  const rawUrl = data.raw_url || data.url;
  process.stdout.write(`${rawUrl}${outputRawUrlSuffix}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
