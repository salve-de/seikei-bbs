const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");

let baseUrl;
let dataDirectory;
let serverProcess;
let serverErrors = "";

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "political-economy-board-"));
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverErrors += chunk.toString();
  });
  await waitForServer();
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test("home exposes issues and verified politician targets", async () => {
  const response = await fetch(`${baseUrl}/api/home`);
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.featured.dailyIssues.length, 4);
  assert.equal(payload.featured.politicians.length, 6);
  assert.equal(payload.featured.dailyIssues[0].reactions.length, 6);

  const politicianResponse = await fetch(`${baseUrl}/api/politicians/takaichi-sanae`);
  assert.equal(politicianResponse.status, 200);
  const politicianPayload = await politicianResponse.json();
  assert.equal(politicianPayload.politician.name, "高市 早苗");
  assert.equal(politicianPayload.threads.length, 1);
});

test("thread creation requires a safe source and a valid target", async () => {
  const unsafeResponse = await createThread({ sourceUrl: "javascript:alert(1)" });
  assert.equal(unsafeResponse.status, 400);
  assert.equal((await unsafeResponse.json()).error, "invalid_source_url");

  const invalidTargetResponse = await createThread({ targetId: "missing-politician" });
  assert.equal(invalidTargetResponse.status, 400);
  assert.equal((await invalidTargetResponse.json()).error, "invalid_thread_target");

  const response = await createThread();
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.thread.target.label, "高市 早苗");
  assert.equal(payload.thread.sourceUrl, "https://www.shugiin.go.jp/");
});

test("reactions persist and enforce a per-type cooldown", async () => {
  const createdResponse = await createThread({ author: "reaction-test" });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const firstResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reaction: "important" }),
  });
  assert.equal(firstResponse.status, 201);
  const firstPayload = await firstResponse.json();
  assert.equal(firstPayload.thread.reactions.find((item) => item.id === "important").count, 1);

  const secondResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reaction: "important" }),
  });
  assert.equal(secondResponse.status, 429);
  assert.equal((await secondResponse.json()).error, "reaction_cooldown");
});

function createThread(overrides = {}) {
  return fetch(`${baseUrl}/api/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      room: "tax",
      author: "api-test",
      title: "議員と一次情報を紐づけるAPIテスト用スレッド",
      summary: "議員ページ、出典URL、感情リアクションが一連で動くことを確認するテスト用の要約です。",
      body: "この本文はAPIの統合テスト用です。必要な文字数を満たし、対象と出典が保存されることを確認します。",
      tags: ["テスト", "議員"],
      sourceUrl: "https://www.shugiin.go.jp/",
      targetType: "politician",
      targetId: "takaichi-sanae",
      ...overrides,
    }),
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`server exited early: ${serverErrors}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/home`);
      if (response.ok) return;
    } catch {
      // Server startup can take a few polling intervals.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`server did not start: ${serverErrors}`);
}
