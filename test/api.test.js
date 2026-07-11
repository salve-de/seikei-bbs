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

  assert.equal(payload.featured.dailyIssues.length, 6);
  assert.equal(payload.featured.politicians.length, 6);
  assert.equal(payload.featured.dailyIssues[0].reactions.length, 4);
  assert.ok(payload.featured.dailyIssues[0].decisionPrompt);
  assert.ok(payload.featured.dailyIssues[0].impactAreas.length > 0);

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

  const minimalResponse = await createThread({
    author: "minimal-thread",
    title: "減税って結局どうなの",
    body: "率直な意見を聞きたい。",
    summary: "",
    decisionPrompt: "",
    impactAreas: [],
    tags: [],
    sourceUrl: "",
    sourceKind: "",
    targetType: "",
    targetId: "",
  });
  assert.equal(minimalResponse.status, 201);
  const minimal = await minimalResponse.json();
  assert.equal(minimal.thread.summary, "率直な意見を聞きたい。");
  assert.equal(minimal.thread.sourceUrl, "");
  assert.equal(minimal.thread.mode, "mixed");
});

test("reactions persist and enforce a per-type cooldown", async () => {
  const createdResponse = await createThread({ author: "reaction-test" });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const firstResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reaction: "curious" }),
  });
  assert.equal(firstResponse.status, 201);
  const firstPayload = await firstResponse.json();
  assert.equal(firstPayload.thread.reactions.find((item) => item.id === "curious").count, 1);

  const secondResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reaction: "curious" }),
  });
  assert.equal(secondResponse.status, 429);
  assert.equal((await secondResponse.json()).error, "reaction_cooldown");
});

test("comments are body-first, numbered, and can reply by quote", async () => {
  const createdResponse = await createThread({ author: "structured-test" });
  const created = await createdResponse.json();

  const positionResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/positions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ position: "unsure" }),
  });
  assert.equal(positionResponse.status, 201);
  assert.equal((await positionResponse.json()).thread.positionTotal, 1);

  const firstCommentResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      author: "検証者",
      body: "出典や立場を選ばず、そのまま書き込めます。",
    }),
  });
  assert.equal(firstCommentResponse.status, 201);
  const firstPayload = await firstCommentResponse.json();
  const firstComment = firstPayload.comments[0];
  assert.equal(firstComment.number, 1);
  assert.equal(firstComment.stance, "");
  assert.equal(firstComment.claimType, "");
  assert.deepEqual(firstComment.impactAreas, []);
  assert.match(firstComment.displayId, /^[A-F0-9]{8}$/);
  assert.equal("actorHash" in firstComment, false);

  const invalidReplyResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ author: "返信検証1", body: ">>1 返信します。", replyToId: "missing-comment" }),
  });
  assert.equal(invalidReplyResponse.status, 400);
  assert.equal((await invalidReplyResponse.json()).error, "invalid_reply_target");

  const replyResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      author: "返信検証2",
      body: ">>1 その見方には反対です。",
      replyToId: firstComment.id,
      claimType: "fact",
    }),
  });
  assert.equal(replyResponse.status, 201);
  const replyPayload = await replyResponse.json();
  const reply = replyPayload.comments.at(-1);
  assert.equal(reply.number, 2);
  assert.equal(reply.replyToId, firstComment.id);
  assert.equal(reply.replyToNumber, 1);
  assert.deepEqual(reply.quotedNumbers, [1]);
  assert.equal(reply.claimType, "fact");
  assert.equal(reply.sourceUrl, "");
  assert.equal(replyPayload.thread.lastCommentNo, 2);
  assert.equal(reply.displayId, firstComment.displayId);

  const otherActorResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-board-actor": "different-session" },
    body: JSON.stringify({ author: "別セッション", body: "別の匿名IDになります。" }),
  });
  assert.equal(otherActorResponse.status, 201);
  const otherActor = (await otherActorResponse.json()).comments.at(-1);
  assert.notEqual(otherActor.displayId, firstComment.displayId);
  assert.equal("actorHash" in otherActor, false);

  const reactionResponse = await fetch(`${baseUrl}/api/threads/${created.thread.id}/comments/${firstComment.id}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-board-actor": "reaction-session" },
    body: JSON.stringify({ reaction: "source" }),
  });
  assert.equal(reactionResponse.status, 201);
  const reacted = (await reactionResponse.json()).comments.find((comment) => comment.id === firstComment.id);
  assert.equal(reacted.reactions.find((reaction) => reaction.id === "source").count, 1);
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
      decisionPrompt: "この政策は家計への影響を踏まえて実施するべきか。",
      impactAreas: ["household", "future"],
      body: "この本文はAPIの統合テスト用です。必要な文字数を満たし、対象と出典が保存されることを確認します。",
      tags: ["テスト", "議員"],
      sourceUrl: "https://www.shugiin.go.jp/",
      sourceKind: "official",
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
