// Shared test harness: starts a local SMTP sink, boots the real server against a test MongoDB
// (TEST_MONGO_URI, or a throwaway in-memory one), and offers a tiny assertion + HTTP client.
import net from "net";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const backendDir = path.resolve(here, "..");

let passed = 0, failed = 0;
const failures = [];
export function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}${extra !== undefined ? "  -> " + JSON.stringify(extra) : ""}`); }
}
export const counts = () => ({ passed, failed, failures });
export const suite = (name) => console.log(`\n== ${name}`);

// Minimal SMTP server that stores every message so tests can read links out of emails.
export function startSmtpSink(port) {
  const mails = [];
  const server = net.createServer((sock) => {
    let data = "", inData = false, from = "", to = [];
    sock.write("220 sink ESMTP\r\n");
    sock.on("data", (buf) => {
      data += buf.toString();
      while (true) {
        if (inData) {
          const end = data.indexOf("\r\n.\r\n");
          if (end === -1) return;
          mails.push({ from, to, body: data.slice(0, end) });
          data = data.slice(end + 5); inData = false;
          sock.write("250 queued\r\n");
          continue;
        }
        const nl = data.indexOf("\r\n");
        if (nl === -1) return;
        const line = data.slice(0, nl); data = data.slice(nl + 2);
        const u = line.toUpperCase();
        if (u.startsWith("EHLO") || u.startsWith("HELO")) sock.write("250 sink\r\n");
        else if (u.startsWith("MAIL FROM")) { from = line.slice(10); sock.write("250 ok\r\n"); }
        else if (u.startsWith("RCPT TO")) { to.push(line.slice(8)); sock.write("250 ok\r\n"); }
        else if (u === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (u === "QUIT") { sock.end("221 bye\r\n"); }
        else sock.write("250 ok\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ mails, close: () => server.close() })));
}

// Decodes quoted-printable so links in the raw mail body can be matched.
export const decodeQP = (s) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
export const tokenFromMail = (m) => (decodeQP(m.body).match(/verify\?token=([A-Za-z0-9_-]+)/) || [])[1];

export async function startServer({ port, mongoUri, dbSuffix, env = {} }) {
  const full = {
    ...process.env, PORT: String(port), NODE_ENV: "development",
    MONGO_URI: mongoUri,
    JWT_SECRET: "test-jwt-secret-test-jwt-secret", ENCRYPTION_KEY: "test-enc-key-test-enc-key-1234",
    SUPERADMIN_EMAIL: "root@test.local", SUPERADMIN_PASSWORD: "RootPass123", SUPERADMIN_NAME: "Root",
    HOSTED_DB_NAME: `guut_hosted_${dbSuffix}`, SIGNUP_RATE_LIMIT: "1000",
    REQUIRE_EMAIL_VERIFICATION: "false", ENFORCE_BILLING: "false",
    APP_URL: `http://localhost:${port}`, ...env,
  };
  const proc = spawn("node", ["server.js"], { cwd: backendDir, env: full, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d)); proc.stderr.on("data", (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) break; } catch {}
    if (proc.exitCode !== null) throw new Error("Server exited early:\n" + out);
    await new Promise((r) => setTimeout(r, 250));
  }
  const api = async (method, url, body, token) => {
    const r = await fetch(base + "/api" + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  return { api, base, stop: () => proc.kill("SIGKILL"), logs: () => out };
}

// Returns { uri, stop }. Uses TEST_MONGO_URI when set (CI service container or FerretDB), else an in-memory server.
export async function testMongo(dbName) {
  if (process.env.TEST_MONGO_URI) return { uri: process.env.TEST_MONGO_URI.replace(/\/?$/, "/") + dbName, stop: async () => {} };
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const m = await MongoMemoryServer.create();
  return { uri: m.getUri() + dbName, stop: () => m.stop() };
}

export const signup = (api, o) => api("POST", "/auth/signup", o);
export async function account(api, o) { const r = await signup(api, o); return { ...r, token: r.body?.token, id: r.body?.user?._id }; }
export const form = (title = "Survey") => ({ title, fields: [
  { id: "f1", type: "text", label: "Name", required: true, order: 0 },
  { id: "f2", type: "select", label: "Pick", options: ["A", "B"], order: 1 },
] });
