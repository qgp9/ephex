#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";

function printUsage() {
  console.error("Usage: ephex-download <url> [output-file]");
  console.error("Supports raw links, viewer links, and encrypted viewer links.");
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:\0]/g, "_").replace(/[\r\n]/g, "").trim() || "download.bin";
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
  const [inputUrl, outputFile] = process.argv.slice(2);

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
  const isEncrypted = Boolean(encryptedKey);
  const finalData = isEncrypted ? await decryptPayload(payload, encryptedKey) : payload;

  await writeFile(outputPath, finalData);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
