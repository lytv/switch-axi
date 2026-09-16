import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Credentials } from "./credentials.js";

export type Operation = {
  description: string;
  input_schema: Record<string, unknown>;
};

export class SwitchClient {
  constructor(private readonly credentials: Credentials) {}

  private get baseUrl(): string {
    return `${this.credentials.endpoint}/agents/${encodeURIComponent(this.credentials.agentId)}`;
  }
  private headers(extra: HeadersInit = {}): HeadersInit {
    return { Authorization: `Bearer ${this.credentials.token}`, ...extra };
  }

  private async response(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `Switch API request failed (HTTP ${response.status}): ${text}`,
      );
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Switch API returned invalid JSON");
    }
  }

  async operations(): Promise<Record<string, Operation>> {
    const data = (await this.response(
      await fetch(`${this.baseUrl}/ops`, { headers: this.headers() }),
    )) as { operations?: Record<string, Operation> };
    if (!data.operations || typeof data.operations !== "object")
      throw new Error("Switch API returned no operation catalog");
    return data.operations;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const data = (await this.response(
      await fetch(`${this.baseUrl}/ops/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(args),
      }),
    )) as { result?: unknown };
    return data.result ?? null;
  }

  async attach(
    roomId: string,
    paths: string[],
    caption?: string,
    threadId?: string,
  ): Promise<unknown> {
    const form = new FormData();
    for (const path of paths) {
      const bytes = new Uint8Array(await readFile(path));
      form.append("files", new Blob([bytes]), basename(path));
    }
    if (caption) form.append("caption", caption);
    if (threadId) form.append("thread_id", threadId);
    return this.response(
      await fetch(`${this.baseUrl}/rooms/${encodeURIComponent(roomId)}/media`, {
        method: "POST",
        headers: this.headers(),
        body: form,
      }),
    );
  }

  async fetch(roomId: string, mxc: string, dest: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/rooms/${encodeURIComponent(roomId)}/media?mxc=${encodeURIComponent(mxc)}`,
      { headers: this.headers() },
    );
    if (!response.ok || !response.body)
      throw new Error(`Switch media download failed (HTTP ${response.status})`);
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(dest),
    );
  }
}
