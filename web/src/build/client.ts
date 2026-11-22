// Build server client (spec section 8.3). VITE_BUILD_URL sets the address (section 10.1).
import type { RemoteProject, SyncAnswer, SyncRequest } from "../project/sync";
import type { Account, BuildResponse, CheckResponse, InfoResponse, ProjectFile, TestbenchResponse } from "./types";

const env = import.meta.env as Record<string, string | undefined>;
export const BUILD_URL: string = (env.VITE_BUILD_URL ?? "http://localhost:8080").replace(/\/+$/, "");

// Server rejection: the code from the response body (UNAUTHORIZED, RATE_LIMITED, BUSY…) or NETWORK when there is no response.
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    text: string,
  ) {
    super(text);
  }
}

// A request to the server; a rejection becomes ServerError. token is an access key or a session token; null sends no
// Authorization header (login sign-in).
async function send(base: string, token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers });
  } catch (e) {
    throw new ServerError(0, "NETWORK", String(e));
  }
  return checked(response);
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  let code = `HTTP_${String(response.status)}`;
  let text = response.statusText;
  try {
    const body = (await response.json()) as { error?: { code?: string; text?: string } };
    code = body.error?.code ?? code;
    text = body.error?.text ?? text;
  } catch {
    // The body is not JSON (for example, an nginx response): the code from the HTTP status stays.
  }
  throw new ServerError(response.status, code, text);
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Sign-in by login and password (accounts spec section 3.1 (docs/tz-accounts.md)): a session token and an account.
export async function login(name: string, password: string, base: string = BUILD_URL): Promise<LoginResponse> {
  const response = await send(base, null, "/v1/auth/login", { method: "POST", ...json({ login: name, password }) });
  return (await response.json()) as LoginResponse;
}

export interface LoginResponse {
  token: string;
  user: Account;
}

// A project in the user project list for the administrator (accounts spec section 3.5): a project in the trash
// has deletedAt; purged means the trash period is over and the files are erased.
export interface AdminProject extends RemoteProject {
  deletedAt?: number;
  purged: boolean;
}

export interface AdminProjectFiles {
  id: string;
  login: string;
  name: string;
  board: string;
  rev: number;
  modified: number;
  files: ProjectFile[];
}

// Server client: token is an access key or a session token; the server tells them apart itself (accounts spec section 2.3).
// A sync request holds the exchange queue of all projects and tabs: a hung request does not occupy it.
const SYNC_TIMEOUT_MS = 30_000;

export class BuildClient {
  constructor(
    readonly token: string,
    private readonly base: string = BUILD_URL,
  ) {}

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return send(this.base, this.token, path, init);
  }

  // timeoutMs is the response wait limit; when it expires, the request counts as a network failure.
  private async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const init: RequestInit = body === undefined ? { method } : { method, ...json(body) };
    if (timeoutMs !== undefined) init.signal = AbortSignal.timeout(timeoutMs);
    const response = await this.request(path, init);
    return (await response.json()) as T;
  }

  // ---- Session and users (accounts spec sections 3.1 and 3.4) ----

  async logout(): Promise<void> {
    await this.call("POST", "/v1/auth/logout");
  }

  async changePassword(current: string, next: string): Promise<void> {
    await this.call("POST", "/v1/auth/password", { current, new: next });
  }

  async users(): Promise<Account[]> {
    return (await this.call<{ users: Account[] }>("GET", "/v1/admin/users")).users;
  }

  async addUser(user: { login: string; name: string; role: string }): Promise<{ user: Account; password: string }> {
    return this.call("POST", "/v1/admin/users", user);
  }

  async updateUser(name: string, change: { name?: string; role?: string; enabled?: boolean }): Promise<Account> {
    return (await this.call<{ user: Account }>("PATCH", `/v1/admin/users/${encodeURIComponent(name)}`, change)).user;
  }

  async resetPassword(name: string): Promise<string> {
    const path = `/v1/admin/users/${encodeURIComponent(name)}/password`;
    return (await this.call<{ password: string }>("POST", path)).password;
  }

  async deleteUser(name: string): Promise<void> {
    await this.call("DELETE", `/v1/admin/users/${encodeURIComponent(name)}`);
  }

  // ---- Projects on the server (accounts spec sections 3.2 and 3.3) ----

  projects(): Promise<{ generation: string; projects: RemoteProject[] }> {
    return this.call("GET", "/v1/projects", undefined, SYNC_TIMEOUT_MS);
  }

  syncProject(id: string, body: SyncRequest): Promise<SyncAnswer> {
    return this.call("POST", `/v1/projects/${encodeURIComponent(id)}/sync`, body, SYNC_TIMEOUT_MS);
  }

  async removeProject(id: string): Promise<void> {
    await this.call("DELETE", `/v1/projects/${encodeURIComponent(id)}`, undefined, SYNC_TIMEOUT_MS);
  }

  // ---- Users' projects, administrator only (accounts spec section 3.5) ----

  async userProjects(name: string): Promise<AdminProject[]> {
    const path = `/v1/admin/users/${encodeURIComponent(name)}/projects`;
    return (await this.call<{ projects: AdminProject[] }>("GET", path)).projects;
  }

  adminProject(id: string): Promise<AdminProjectFiles> {
    return this.call("GET", `/v1/admin/projects/${encodeURIComponent(id)}`);
  }

  async restoreProject(id: string): Promise<void> {
    await this.call("POST", `/v1/admin/projects/${encodeURIComponent(id)}/restore`);
  }

  // ---- Build ----

  async info(): Promise<InfoResponse> {
    return (await (await this.request("/v1/info")).json()) as InfoResponse;
  }

  // config is the content of fpgasim.json or null; it is not in files (decision 35).
  async build(files: ProjectFile[], config: unknown): Promise<BuildResponse> {
    const response = await this.request("/v1/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, config, options: { visibility: null } }),
    });
    return (await response.json()) as BuildResponse;
  }

  // Quick check without compiling: same request, the response has no build files (spec section 8.3).
  async check(files: ProjectFile[], config: unknown): Promise<CheckResponse> {
    const response = await this.request("/v1/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, config, options: { visibility: null } }),
    });
    return (await response.json()) as CheckResponse;
  }

  // Run a testbench on the server: project files and the path of the testbench file (spec section 8.3).
  async testbench(files: ProjectFile[], config: unknown, testbench: string): Promise<TestbenchResponse> {
    const response = await this.request("/v1/testbench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, config, testbench }),
    });
    return (await response.json()) as TestbenchResponse;
  }

  // A build file by the path from the artifacts field.
  async artifact(path: string): Promise<ArrayBuffer> {
    return (await this.request(path)).arrayBuffer();
  }
}

// Server state for the projects screen: /v1/health answers without a key.
export async function serverHealthy(base: string = BUILD_URL): Promise<boolean> {
  try {
    const response = await fetch(`${base}/v1/health`);
    return response.ok;
  } catch {
    return false;
  }
}
