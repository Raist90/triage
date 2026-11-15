import { invoke } from "@tauri-apps/api/core";
import type { Handshake } from "./types";

let pending: Promise<Handshake> | null = null;

/**
 * Resolves the dev server's port + bearer token.
 *
 * Dev: `/.triage-handshake`, served by the Vite dev plugin.
 * Prod: the Tauri `handshake` command.
 *
 * Memoized: the port and token never change for the life of an app session.
 * A failed attempt is not memoized, so Retry can recover once the server is up.
 */
export function getHandshake(): Promise<Handshake> {
  pending ??= resolveHandshake().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

async function resolveHandshake(): Promise<Handshake> {
  const value = import.meta.env.DEV
    ? await fetchDevHandshake()
    : await invoke<unknown>("handshake");
  return parseHandshake(value);
}

async function fetchDevHandshake(): Promise<unknown> {
  const response = await fetch("/.triage-handshake", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Handshake unavailable (HTTP ${response.status})`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Handshake response is not JSON");
  }
}

function parseHandshake(value: unknown): Handshake {
  if (isRecord(value)) {
    const { port, token } = value;
    if (typeof port === "number" && typeof token === "string") {
      return { port, token };
    }
  }
  throw new Error("Handshake payload is missing a port or token");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
