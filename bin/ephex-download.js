#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, privateDecrypt, constants, webcrypto } from "node:crypto";

function printUsage() {
  console.error("Usage: ephex-download [--private-key /path/to/private.pem] <url> [output-file]");
  console.error("Supports plain, symmetric-encrypted, and public-key-encrypted raw links.");
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:\0]/g, "_").replace(/[\r\n]/g, "").trim() || "download.bin";
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

function loadDotEnvPrivateKeyPath() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return "";
  const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  return parsed.EPHEX_PRIVATE_KEY || "";
}

function parseContentDisposition(header) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return sanitizeFilename(decodeURIComponent(utf8Match[1]));
  }

  const asciiMatch = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i);
  if (asciiMatch) {
    return sanitizeFilename(asciiMatch[1].trim());
  }

  return null;
}

function resolveDownloadTarget(inputUrl) {
  const url = new URL(inputUrl);
  const encryptedKey = url.hash ? url.hash.slice(1) : null;

  if (url.pathname.startsWith("/img/")) {
    const lastSegment = url.pathname.split("/").pop() || "";
    if (lastSegment.includes(".")) {
      return { fetchUrl: new URL(url.origin + url.pathname), encryptedKey };
    }
  }

  if (url.pathname.startsWith("/api/raw/")) {
    return { fetchUrl: new URL(url.origin + url.pathname), encryptedKey };
  }

  const imageId = url.searchParams.get("id");
  const encryptedId = url.searchParams.get("v");

  if (imageId) {
    return { fetchUrl: new URL(`/api/raw/${imageId}`, url.origin), encryptedKey: null };
  }

  if (encryptedId) {
    return { fetchUrl: new URL(`/api/raw/${encryptedId}`, url.origin), encryptedKey };
  }

  throw new Error("Unsupported Ephex URL");
}

async function decryptPayload(buffer, keyBase64Url) {
  if (!keyBase64Url) {
    throw new Error("Encrypted link is missing a decryption key in the URL hash");
  }

  const rawKey = decodeBase64Url(keyBase64Url);
  const key = await webcrypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = buffer.subarray(0, 12);
  const ciphertext = buffer.subarray(12);

  if (iv.length !== 12 || ciphertext.length === 0) {
    throw new Error("Encrypted payload is malformed");
  }

  const decrypted = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return Buffer.from(decrypted);
}

async function decryptPayloadWithPrivateKey(buffer, wrappedKeyBase64Url, privateKeyPath, keyAlgorithm) {
  if (!wrappedKeyBase64Url) {
    throw new Error("Encrypted payload is missing the wrapped AES key");
  }

  if (!privateKeyPath) {
    throw new Error("Public-key encrypted payload requires --private-key");
  }

  const pem = await readFile(privateKeyPath, "utf8");
  const privateKey = createPrivateKey(pem);
  const wrappedKey = decodeBase64Url(wrappedKeyBase64Url);
  const oaepHash = keyAlgorithm === "RSA-OAEP-256" ? "sha256" : "sha1";
  const rawKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash,
    },
    wrappedKey
  );

  return decryptPayload(buffer, rawKey.toString("base64url"));
}

function inferFilename(fetchUrl, response, explicitOutput) {
  if (explicitOutput) {
    return explicitOutput;
  }

  const headerName = parseContentDisposition(response.headers.get("content-disposition"));
  if (headerName) {
    return path.resolve(process.cwd(), headerName);
  }

  const pathnameName = path.basename(fetchUrl.pathname);
  if (pathnameName && pathnameName !== "raw") {
    return path.resolve(process.cwd(), sanitizeFilename(decodeURIComponent(pathnameName)));
  }

  return path.resolve(process.cwd(), "download.bin");
}

async function main() {
  const args = [...process.argv.slice(2)];
  let privateKeyPath = "";

  if (args[0] === "--private-key") {
    privateKeyPath = args[1] || "";
    args.splice(0, 2);
  }

  privateKeyPath = privateKeyPath || process.env.EPHEX_PRIVATE_KEY || loadDotEnvPrivateKeyPath();

  const [inputUrl, outputFile] = args;

  if (!inputUrl || inputUrl === "--help" || inputUrl === "-h") {
    printUsage();
    process.exit(inputUrl ? 0 : 1);
  }

  const { fetchUrl, encryptedKey } = resolveDownloadTarget(inputUrl);
  const response = await fetch(fetchUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const outputPath = inferFilename(fetchUrl, response, outputFile ? path.resolve(process.cwd(), outputFile) : null);
  const payload = Buffer.from(await response.arrayBuffer());
  const encryptionMode = response.headers.get("x-ephex-encryption-mode") || (encryptedKey ? "symmetric" : "plain");
  const wrappedKey = response.headers.get("x-ephex-encrypted-key") || "";
  const keyAlgorithm = response.headers.get("x-ephex-key-algorithm") || "";
  let finalData = payload;

  if (encryptionMode === "symmetric") {
    finalData = await decryptPayload(payload, encryptedKey);
  } else if (encryptionMode === "public_key") {
    finalData = await decryptPayloadWithPrivateKey(payload, wrappedKey, privateKeyPath, keyAlgorithm);
  }

  await writeFile(outputPath, finalData);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
