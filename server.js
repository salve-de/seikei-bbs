const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const express = require("express");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const MAX_PORT_ATTEMPTS = 20;
const LOCAL_HOSTS = ["127.0.0.1", "::1"];
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const THREADS_FILE = path.join(DATA_DIR, "threads.json");
const COMMENTS_FILE = path.join(DATA_DIR, "comments.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const politicianDefinitions = require("./data/politicians.json");
const THREAD_COOLDOWN_MS = 30_000;
const DEFAULT_COMMENT_COOLDOWN_MS = 15_000;
const REACTION_COOLDOWN_MS = 10 * 60_000;
const MAX_THREAD_COUNT = 300;
const MAX_COMMENT_COUNT = 500;

const targetDefinitions = [
  { id: "policy", label: "政策" },
  { id: "politician", label: "議員" },
  { id: "party", label: "政党・会派" },
  { id: "district", label: "選挙区・地域" },
  { id: "economy", label: "経済指標・市場" },
];

const reactionDefinitions = [
  { id: "concern", label: "不安", tone: "concern" },
  { id: "angry", label: "怒り", tone: "angry" },
  { id: "hope", label: "期待", tone: "hope" },
  { id: "curious", label: "疑問", tone: "curious" },
];

const positionDefinitions = [
  { id: "support", label: "賛成寄り" },
  { id: "oppose", label: "反対寄り" },
  { id: "unsure", label: "判断保留" },
];

const impactDefinitions = [
  { id: "household", label: "家計" },
  { id: "work", label: "仕事" },
  { id: "region", label: "地域" },
  { id: "future", label: "将来" },
  { id: "rights", label: "権利・制度" },
  { id: "security", label: "安全" },
];

const claimDefinitions = [
  { id: "experience", label: "自分の体験" },
  { id: "opinion", label: "意見・予想" },
  { id: "fact", label: "事実・データ" },
  { id: "question", label: "質問" },
];

const helpfulnessDefinitions = [
  { id: "useful", label: "参考になった" },
  { id: "changed", label: "見方が変わった" },
  { id: "weak", label: "根拠が弱い" },
];

const roomDefinitions = [
  {
    id: "money",
    label: "政治とカネ",
    note: "汚職、献金、不祥事",
    prompt: "人ではなく制度、流れ、抜け道に寄せて議論する。",
    suggestedTags: ["政治資金", "献金", "裏金", "監査"],
  },
  {
    id: "tax",
    label: "税と社会保険",
    note: "減税、給付、負担",
    prompt: "家計、財源、受益層、時間軸に分ける。",
    suggestedTags: ["減税", "給付", "社会保険", "消費税"],
  },
  {
    id: "prices",
    label: "物価と家計",
    note: "物価、賃金、生活",
    prompt: "実感、統計、雇用の3本で議論する。",
    suggestedTags: ["物価高", "実質賃金", "家計", "雇用"],
  },
  {
    id: "boj",
    label: "日銀・相場",
    note: "円安、金利、株価",
    prompt: "為替、金利、企業収益、家計負担を切り分ける。",
    suggestedTags: ["日銀", "円安", "株価", "金利"],
  },
  {
    id: "security",
    label: "外交安全保障",
    note: "地政学、資源、外交",
    prompt: "安全保障だけでなく、エネルギーと物流まで戻す。",
    suggestedTags: ["安全保障", "外交", "防衛費", "資源"],
  },
  {
    id: "election",
    label: "選挙・政局",
    note: "支持率、候補者、国会",
    prompt: "雰囲気論ではなく、争点が議席にどう効くかを見る。",
    suggestedTags: ["選挙", "支持率", "国会", "政局"],
  },
];

const boardState = {
  threads: [],
  comments: {},
  reports: [],
  lastSavedAt: null,
  rateLimits: new Map(),
};

app.use(express.json({ limit: "300kb" }));

app.get("/", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/room/:roomId", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "room.html"));
});

app.get("/new", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "new.html"));
});

app.get("/politicians", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "politicians.html"));
});

app.get("/politician/:politicianId", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "politician.html"));
});

app.get("/thread/:threadId", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "thread.html"));
});

app.get("/moderation", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "moderation.html"));
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("/api/board", (_request, response) => {
  response.json(buildBoardPayload());
});

app.get("/api/home", (_request, response) => {
  response.json(buildHomePayload());
});

app.get("/api/politicians", (_request, response) => {
  response.json({
    politicians: politicianDefinitions.map((politician) => decoratePolitician(politician)),
    rooms: roomDefinitions,
    meta: {
      verifiedAt: latestPoliticianVerificationDate(),
    },
  });
});

app.get("/api/politicians/:politicianId", (request, response) => {
  const politician = findPolitician(request.params.politicianId);

  if (!politician) {
    response.status(404).json({ error: "politician_not_found" });
    return;
  }

  response.json({
    politician: decoratePolitician(politician),
    threads: sortThreads(threadsForPolitician(politician.id)),
    rooms: roomDefinitions,
    reactionDefinitions,
  });
});

app.get("/api/rooms/:roomId", (request, response) => {
  const payload = buildRoomPayload(request.params.roomId);

  if (!payload) {
    response.status(404).json({ error: "room_not_found" });
    return;
  }

  response.json(payload);
});

app.get("/api/threads/:threadId", (request, response) => {
  const thread = boardState.threads.find((item) => item.id === request.params.threadId);

  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  response.json({
    thread: decorateThread(thread),
    room: findRoom(thread.room),
    comments: decorateComments(thread.id),
    relatedThreads: relatedThreadsForThread(thread),
    reactionDefinitions,
    positionDefinitions,
    impactDefinitions,
    claimDefinitions,
    helpfulnessDefinitions,
  });
});

app.get("/api/moderation/queue", (_request, response) => {
  response.json({
    reports: pendingReports(),
  });
});

app.post("/api/threads", async (request, response) => {
  const author = normalizeText(request.body?.author || "名無しさん").slice(0, 32) || "名無しさん";
  const room = normalizeText(request.body?.room);
  const title = normalizeText(request.body?.title);
  const summary = normalizeText(request.body?.summary);
  const body = normalizeText(request.body?.body);
  const sourceUrl = normalizeUrl(request.body?.sourceUrl);
  const tags = normalizeTags(request.body?.tags);
  const decisionPrompt = normalizeText(request.body?.decisionPrompt);
  const impactAreas = normalizeImpactAreas(request.body?.impactAreas);
  const sourceKind = normalizeText(request.body?.sourceKind);
  const megathread = Boolean(request.body?.megathread);
  const target = normalizeThreadTarget(request.body);

  if (!roomDefinitions.some((item) => item.id === room)) {
    response.status(400).json({ error: "invalid_room" });
    return;
  }

  if (title.length < 8 || title.length > 120) {
    response.status(400).json({ error: "invalid_title" });
    return;
  }

  if (summary.length < 20 || summary.length > 240) {
    response.status(400).json({ error: "invalid_summary" });
    return;
  }

  if (body.length < 30 || body.length > 4000) {
    response.status(400).json({ error: "invalid_body" });
    return;
  }

  if (tags.length === 0 || tags.length > 4) {
    response.status(400).json({ error: "invalid_tags" });
    return;
  }

  if (!sourceUrl) {
    response.status(400).json({ error: "invalid_source_url" });
    return;
  }

  if (!target) {
    response.status(400).json({ error: "invalid_thread_target" });
    return;
  }

  if (decisionPrompt.length < 10 || decisionPrompt.length > 180) {
    response.status(400).json({ error: "invalid_decision_prompt" });
    return;
  }

  if (impactAreas.length === 0 || impactAreas.length > 3) {
    response.status(400).json({ error: "invalid_impact_areas" });
    return;
  }

  if (!["official", "news", "analysis", "other"].includes(sourceKind)) {
    response.status(400).json({ error: "invalid_source_kind" });
    return;
  }

  const threadFingerprint = actionFingerprint(request, author, `thread:${room}`);
  const blockedUntil = nextAllowedAt(threadFingerprint, THREAD_COOLDOWN_MS);

  if (blockedUntil) {
    response.status(429).json({
      error: "thread_cooldown",
      nextAllowedAt: blockedUntil,
    });
    return;
  }

  const now = new Date().toISOString();
  const thread = {
    id: makeId(`thread:${title}:${now}:${author}`),
    room,
    author,
    title,
    summary,
    body,
    sourceUrl,
    sourceKind,
    decisionPrompt,
    impactAreas,
    tags,
    ...target,
    reactions: emptyReactionCounts(),
    positions: emptyPositionCounts(),
    createdAt: now,
    updatedAt: now,
    lastCommentAt: null,
    megathread,
    pinned: megathread,
    locked: false,
    slowModeSeconds: megathread ? 60 : 0,
    moderationNote: megathread
      ? "継続テーマなので slow mode 60 秒を初期設定。"
      : "未設定",
  };

  boardState.threads = [thread, ...boardState.threads].slice(0, MAX_THREAD_COUNT);
  boardState.comments[thread.id] = [];
  boardState.rateLimits.set(threadFingerprint, Date.now());

  await persistBoard();

  response.status(201).json({
    ok: true,
    thread: decorateThread(thread),
    board: buildBoardPayload(),
  });
});

app.post("/api/threads/:threadId/positions", async (request, response) => {
  const thread = boardState.threads.find((item) => item.id === request.params.threadId);
  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  const position = normalizeText(request.body?.position);
  if (!positionDefinitions.some((item) => item.id === position)) {
    response.status(400).json({ error: "invalid_position" });
    return;
  }

  const fingerprint = actionFingerprint(request, "anonymous", `position:${thread.id}`);
  const blockedUntil = nextAllowedAt(fingerprint, REACTION_COOLDOWN_MS);
  if (blockedUntil) {
    response.status(429).json({ error: "position_cooldown", nextAllowedAt: blockedUntil });
    return;
  }

  const counts = normalizePositionCounts(thread.positions);
  counts[position] += 1;
  thread.positions = counts;
  boardState.rateLimits.set(fingerprint, Date.now());
  await persistBoard();

  response.status(201).json({ ok: true, thread: decorateThread(thread) });
});

app.post("/api/threads/:threadId/reactions", async (request, response) => {
  const thread = boardState.threads.find((item) => item.id === request.params.threadId);

  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  const reactionId = normalizeText(request.body?.reaction);
  if (!reactionDefinitions.some((item) => item.id === reactionId)) {
    response.status(400).json({ error: "invalid_reaction" });
    return;
  }

  const reactionFingerprint = actionFingerprint(
    request,
    "anonymous",
    `reaction:${thread.id}:${reactionId}`
  );
  const blockedUntil = nextAllowedAt(reactionFingerprint, REACTION_COOLDOWN_MS);

  if (blockedUntil) {
    response.status(429).json({
      error: "reaction_cooldown",
      nextAllowedAt: blockedUntil,
    });
    return;
  }

  const reactionCounts = normalizeReactionCounts(thread.reactions);
  reactionCounts[reactionId] += 1;
  thread.reactions = reactionCounts;
  boardState.rateLimits.set(reactionFingerprint, Date.now());

  await persistBoard();

  response.status(201).json({
    ok: true,
    thread: decorateThread(thread),
  });
});

app.post("/api/threads/:threadId/comments", async (request, response) => {
  const thread = boardState.threads.find((item) => item.id === request.params.threadId);

  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  if (thread.locked) {
    response.status(409).json({ error: "thread_locked" });
    return;
  }

  const author = normalizeText(request.body?.author || "名無しさん").slice(0, 32) || "名無しさん";
  const body = normalizeText(request.body?.body);
  const stance = normalizeText(request.body?.stance);
  const claimType = normalizeText(request.body?.claimType);
  const impactAreas = normalizeImpactAreas(request.body?.impactAreas);
  const sourceUrl = normalizeUrl(request.body?.sourceUrl);

  if (body.length < 2 || body.length > 1000) {
    response.status(400).json({ error: "invalid_comment_body" });
    return;
  }

  if (!positionDefinitions.some((item) => item.id === stance)) {
    response.status(400).json({ error: "invalid_comment_stance" });
    return;
  }

  if (!claimDefinitions.some((item) => item.id === claimType)) {
    response.status(400).json({ error: "invalid_claim_type" });
    return;
  }

  if (impactAreas.length === 0 || impactAreas.length > 3) {
    response.status(400).json({ error: "invalid_impact_areas" });
    return;
  }

  if (claimType === "fact" && !sourceUrl) {
    response.status(400).json({ error: "fact_requires_source" });
    return;
  }

  const commentCooldownMs = Math.max(
    DEFAULT_COMMENT_COOLDOWN_MS,
    Number(thread.slowModeSeconds || 0) * 1000
  );
  const commentFingerprint = actionFingerprint(request, author, `comment:${thread.id}`);
  const blockedUntil = nextAllowedAt(commentFingerprint, commentCooldownMs);

  if (blockedUntil) {
    response.status(429).json({
      error: "comment_cooldown",
      nextAllowedAt: blockedUntil,
    });
    return;
  }

  const comment = {
    id: makeId(`comment:${thread.id}:${author}:${Date.now()}:${body}`),
    author,
    body,
    stance,
    claimType,
    impactAreas,
    sourceUrl,
    helpfulness: emptyHelpfulnessCounts(),
    createdAt: new Date().toISOString(),
  };

  boardState.comments[thread.id] = [comment, ...(boardState.comments[thread.id] || [])].slice(
    0,
    MAX_COMMENT_COUNT
  );
  thread.updatedAt = comment.createdAt;
  thread.lastCommentAt = comment.createdAt;
  boardState.rateLimits.set(commentFingerprint, Date.now());

  await persistBoard();

  response.status(201).json({
    ok: true,
    thread: decorateThread(thread),
    comments: decorateComments(thread.id),
  });
});

app.post("/api/threads/:threadId/comments/:commentId/helpfulness", async (request, response) => {
  const comments = boardState.comments[request.params.threadId] || [];
  const comment = comments.find((item) => item.id === request.params.commentId);
  if (!comment) {
    response.status(404).json({ error: "comment_not_found" });
    return;
  }

  const signal = normalizeText(request.body?.signal);
  if (!helpfulnessDefinitions.some((item) => item.id === signal)) {
    response.status(400).json({ error: "invalid_helpfulness" });
    return;
  }

  const fingerprint = actionFingerprint(
    request,
    "anonymous",
    `helpfulness:${comment.id}:${signal}`
  );
  const blockedUntil = nextAllowedAt(fingerprint, REACTION_COOLDOWN_MS);
  if (blockedUntil) {
    response.status(429).json({ error: "helpfulness_cooldown", nextAllowedAt: blockedUntil });
    return;
  }

  const counts = normalizeHelpfulnessCounts(comment.helpfulness);
  counts[signal] += 1;
  comment.helpfulness = counts;
  boardState.rateLimits.set(fingerprint, Date.now());
  await persistBoard();

  response.status(201).json({ ok: true, comments: decorateComments(request.params.threadId) });
});

app.post("/api/reports", async (request, response) => {
  const targetType = normalizeText(request.body?.targetType);
  const threadId = normalizeText(request.body?.threadId);
  const targetId = normalizeText(request.body?.targetId);
  const reason = normalizeText(request.body?.reason);
  const details = normalizeText(request.body?.details).slice(0, 400);
  const reporter = normalizeText(request.body?.reporter || "匿名通報").slice(0, 32) || "匿名通報";

  if (!["thread", "comment"].includes(targetType)) {
    response.status(400).json({ error: "invalid_report_target" });
    return;
  }

  if (!["誹謗中傷", "個人攻撃", "デマ", "スパム", "荒らし", "その他"].includes(reason)) {
    response.status(400).json({ error: "invalid_report_reason" });
    return;
  }

  const thread = boardState.threads.find((item) => item.id === threadId);
  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  if (targetType === "comment") {
    const commentExists = (boardState.comments[threadId] || []).some((item) => item.id === targetId);
    if (!commentExists) {
      response.status(404).json({ error: "comment_not_found" });
      return;
    }
  }

  if (targetType === "thread" && targetId !== threadId) {
    response.status(400).json({ error: "invalid_thread_report" });
    return;
  }

  const report = {
    id: makeId(`report:${targetType}:${targetId}:${Date.now()}:${reason}`),
    targetType,
    threadId,
    targetId,
    reason,
    details,
    reporter,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolutionNote: "",
  };

  boardState.reports = [report, ...boardState.reports];
  await persistBoard();

  response.status(201).json({
    ok: true,
    moderation: buildModerationSummary(),
    reports: pendingReports(),
  });
});

app.post("/api/moderation/threads/:threadId", async (request, response) => {
  const thread = boardState.threads.find((item) => item.id === request.params.threadId);

  if (!thread) {
    response.status(404).json({ error: "thread_not_found" });
    return;
  }

  const action = normalizeText(request.body?.action);

  if (action === "toggle-lock") {
    thread.locked = !thread.locked;
    thread.moderationNote = thread.locked ? "運営が一時ロック。" : "ロック解除済み。";
  } else if (action === "toggle-pin") {
    thread.pinned = !thread.pinned;
    thread.moderationNote = thread.pinned ? "運営がピン留め。" : "ピン留め解除済み。";
  } else if (action === "set-slow-mode") {
    const seconds = clamp(Number(request.body?.seconds || 0), 0, 600);
    thread.slowModeSeconds = seconds;
    thread.moderationNote = seconds ? `slow mode ${seconds} 秒。` : "slow mode 解除済み。";
  } else {
    response.status(400).json({ error: "invalid_moderation_action" });
    return;
  }

  thread.updatedAt = new Date().toISOString();
  await persistBoard();

  response.json({
    ok: true,
    thread: decorateThread(thread),
    board: buildBoardPayload(),
  });
});

app.post("/api/moderation/reports/:reportId", async (request, response) => {
  const report = boardState.reports.find((item) => item.id === request.params.reportId);

  if (!report) {
    response.status(404).json({ error: "report_not_found" });
    return;
  }

  report.status = normalizeText(request.body?.status) === "dismissed" ? "dismissed" : "resolved";
  report.resolutionNote = normalizeText(request.body?.note).slice(0, 240);
  report.resolvedAt = new Date().toISOString();

  await persistBoard();

  response.json({
    ok: true,
    reports: pendingReports(),
    moderation: buildModerationSummary(),
  });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: "internal_error",
    message: error instanceof Error ? error.message : "unknown_error",
  });
});

async function bootstrap() {
  await ensureStorage();
  await loadBoard();
  const { port, reusedRequestedPort } = await listenWithFallback(DEFAULT_PORT);

  if (!reusedRequestedPort) {
    console.log(
      `Requested port ${DEFAULT_PORT} was unavailable. Switched to http://localhost:${port}`
    );
  }

  console.log(`Political Economy Bulletin Board listening on http://localhost:${port}`);
}

async function listenWithFallback(preferredPort) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = preferredPort + attempt;
    const portIsAvailable = await canListenOnPort(port);

    if (!portIsAvailable) {
      continue;
    }

    await new Promise((resolve, reject) => {
      const server = app.listen(port, resolve);
      server.on("error", reject);
    });

    return {
      port,
      reusedRequestedPort: port === preferredPort,
    };
  }

  throw new Error(
    `No available port found between ${preferredPort} and ${
      preferredPort + MAX_PORT_ATTEMPTS - 1
    }`
  );
}

function canListenOnPort(port) {
  return Promise.all(LOCAL_HOSTS.map((host) => canListenOnHost(port, host))).then((results) =>
    results.every(Boolean)
  );
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once("error", (error) => {
      if (error && ["EADDRINUSE", "EACCES"].includes(error.code)) {
        resolve(false);
        return;
      }

      if (error && ["EADDRNOTAVAIL", "EINVAL"].includes(error.code)) {
        resolve(true);
        return;
      }

      resolve(false);
    });

    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });

    probe.listen(port, host);
  });
}

function buildBoardPayload() {
  return {
    rooms: roomDefinitions,
    threads: boardState.threads.map((thread) => decorateThread(thread)),
    politicians: politicianDefinitions.map((politician) => decoratePolitician(politician)),
    targetDefinitions,
    reactionDefinitions,
    positionDefinitions,
    impactDefinitions,
    claimDefinitions,
    moderation: buildModerationSummary(),
    meta: {
      lastSavedAt: boardState.lastSavedAt,
      totalTags: topTags(),
      totalThreads: boardState.threads.length,
      totalComments: totalCommentCount(),
    },
  };
}

function buildHomePayload() {
  const threads = sortThreads(boardState.threads.map((thread) => decorateThread(thread)));

  return {
    rooms: roomDefinitions.map((room) => {
      const roomThreads = sortThreads(threadsForRoom(room.id));

      return {
        ...room,
        threadCount: roomThreads.length,
        commentCount: roomThreads.reduce((sum, thread) => sum + thread.commentCount, 0),
        pendingReportsCount: roomThreads.reduce(
          (sum, thread) => sum + thread.pendingReportsCount,
          0
        ),
        latestActivityAt: roomThreads[0]?.lastActivityAt || null,
        hotThread: roomThreads[0] || null,
        topTags: topTagsForThreads(roomThreads, 4),
      };
    }),
    featured: {
      dailyIssues: [...threads]
        .sort((left, right) => right.value - left.value || right.heat - left.heat)
        .slice(0, 6),
      hotThreads: threads.slice(0, 8),
      groundedThreads: [...threads]
        .sort((left, right) => right.evidenceRate - left.evidenceRate || right.value - left.value)
        .slice(0, 6),
      bridgingThreads: [...threads]
        .sort((left, right) => right.bridgeSignals - left.bridgeSignals || right.value - left.value)
        .slice(0, 6),
      newestThreads: [...threads]
        .sort(
          (left, right) =>
            new Date(right.lastActivityAt || right.createdAt).getTime() -
            new Date(left.lastActivityAt || left.createdAt).getTime()
        )
        .slice(0, 8),
      megathreads: threads.filter((thread) => thread.megathread).slice(0, 6),
      politicians: politicianDefinitions
        .map((politician) => decoratePolitician(politician))
        .sort((left, right) => right.activityCount - left.activityCount)
        .slice(0, 6),
    },
    moderation: buildModerationSummary(),
    meta: {
      lastSavedAt: boardState.lastSavedAt,
      totalThreads: boardState.threads.length,
      totalComments: totalCommentCount(),
      totalTags: topTags(),
    },
  };
}

function buildRoomPayload(roomId) {
  const room = findRoom(roomId);

  if (!room) {
    return null;
  }

  const threads = sortThreads(threadsForRoom(room.id));

  return {
    room: {
      ...room,
      threadCount: threads.length,
      commentCount: threads.reduce((sum, thread) => sum + thread.commentCount, 0),
      pendingReportsCount: threads.reduce((sum, thread) => sum + thread.pendingReportsCount, 0),
      latestActivityAt: threads[0]?.lastActivityAt || null,
      megathreads: threads.filter((thread) => thread.megathread).length,
      slowedThreads: threads.filter((thread) => Number(thread.slowModeSeconds || 0) > 0).length,
      topTags: topTagsForThreads(threads, 8),
    },
    threads,
    featured: {
      pinnedThreads: threads.filter((thread) => thread.pinned).slice(0, 4),
      hottestThreads: threads.slice(0, 5),
    },
    rooms: roomDefinitions,
    moderation: buildModerationSummary(),
    meta: {
      lastSavedAt: boardState.lastSavedAt,
    },
  };
}

function buildModerationSummary() {
  return {
    pendingReports: boardState.reports.filter((item) => item.status === "pending").length,
    lockedThreads: boardState.threads.filter((item) => item.locked).length,
    slowedThreads: boardState.threads.filter((item) => Number(item.slowModeSeconds || 0) > 0).length,
    megathreads: boardState.threads.filter((item) => item.megathread).length,
  };
}

function decorateThread(thread) {
  const comments = boardState.comments[thread.id] || [];
  const pendingReportsCount = boardState.reports.filter(
    (item) =>
      item.status === "pending" &&
      (item.threadId === thread.id || (item.targetType === "thread" && item.targetId === thread.id))
  ).length;
  const lastActivityAt = comments[0]?.createdAt || thread.updatedAt || thread.createdAt;
  const reactionCounts = normalizeReactionCounts(thread.reactions);
  const reactions = reactionDefinitions.map((definition) => ({
    ...definition,
    count: reactionCounts[definition.id],
  }));
  const reactionTotal = reactions.reduce((sum, item) => sum + item.count, 0);
  const positionCounts = normalizePositionCounts(thread.positions);
  const positions = positionDefinitions.map((definition) => ({
    ...definition,
    count: positionCounts[definition.id],
  }));
  const normalizedComments = comments.map((comment) => normalizeComment(comment, thread));
  const evidenceCount = 1 + normalizedComments.filter((comment) => comment.sourceUrl).length;
  const evidenceRate = Math.round((evidenceCount / (normalizedComments.length + 1)) * 100);
  const bridgeSignals = normalizedComments.reduce(
    (sum, comment) => sum + normalizeHelpfulnessCounts(comment.helpfulness).changed,
    0
  );

  return {
    ...thread,
    target: resolveThreadTarget(thread),
    reactions,
    reactionTotal,
    positions,
    positionTotal: positions.reduce((sum, item) => sum + item.count, 0),
    impactAreas: normalizeImpactAreas(thread.impactAreas).length
      ? normalizeImpactAreas(thread.impactAreas)
      : defaultImpactsForRoom(thread.room),
    evidenceRate,
    bridgeSignals,
    commentCount: comments.length,
    lastActivityAt,
    pendingReportsCount,
    heat: computeHeat(thread, comments.length, lastActivityAt, reactionTotal),
    freshness: computeFreshness(lastActivityAt),
    value: computeValue(thread, normalizedComments),
  };
}

function decoratePolitician(politician) {
  const threads = threadsForPolitician(politician.id);
  const reactionCount = threads.reduce((sum, thread) => sum + thread.reactionTotal, 0);
  const commentCount = threads.reduce((sum, thread) => sum + thread.commentCount, 0);
  const latestActivityAt = threads
    .map((thread) => thread.lastActivityAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    ...politician,
    threadCount: threads.length,
    commentCount,
    reactionCount,
    activityCount: threads.length + commentCount + reactionCount,
    latestActivityAt,
  };
}

function decorateComments(threadId) {
  const thread = boardState.threads.find((item) => item.id === threadId);
  return (boardState.comments[threadId] || []).map((rawComment) => {
    const comment = normalizeComment(rawComment, thread);
    return {
    ...comment,
    helpfulness: helpfulnessDefinitions.map((definition) => ({
      ...definition,
      count: normalizeHelpfulnessCounts(comment.helpfulness)[definition.id],
    })),
    pendingReportsCount: boardState.reports.filter(
      (item) => item.status === "pending" && item.targetType === "comment" && item.targetId === comment.id
    ).length,
  };
  });
}

function pendingReports() {
  return boardState.reports
    .filter((item) => item.status === "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((report) => {
      const thread = boardState.threads.find((item) => item.id === report.threadId);
      const comment =
        report.targetType === "comment"
          ? (boardState.comments[report.threadId] || []).find((item) => item.id === report.targetId)
          : null;

      return {
        ...report,
        threadTitle: thread?.title || "不明なスレッド",
        room: thread?.room || "",
        snippet:
          report.targetType === "thread"
            ? thread?.summary || ""
            : comment?.body || "",
      };
    });
}

function topTags() {
  return topTagsForThreads(boardState.threads, 12);
}

function topTagsForThreads(threads, limit = 12) {
  const counts = new Map();

  for (const thread of threads) {
    for (const tag of thread.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function computeHeat(thread, commentCount, lastActivityAt, reactionTotal = 0) {
  const ageHours = Math.max(0, (Date.now() - new Date(lastActivityAt).getTime()) / 36e5);
  let score = 34;
  score += Math.max(0, 42 - ageHours * 5);
  score += commentCount * 7;
  score += Math.min(reactionTotal, 10);
  score += thread.pinned ? 10 : 0;
  score += thread.megathread ? 8 : 0;
  return clamp(Math.round(score), 5, 99);
}

function computeFreshness(timestamp) {
  const ageHours = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 36e5);
  return clamp(Math.round(100 - ageHours * 8), 8, 100);
}

function computeValue(thread, comments) {
  let score = 24 + (thread.tags?.length || 0) * 5 + comments.length * 2;
  score += thread.sourceUrl ? 8 : 0;
  score += thread.decisionPrompt ? 10 : 0;
  score += normalizeImpactAreas(thread.impactAreas).length * 4;
  score += comments.filter((comment) => comment.sourceUrl).length * 5;
  const representedStances = new Set(comments.map((comment) => comment.stance)).size;
  score += representedStances > 1 ? 8 : 0;
  return clamp(Math.round(score), 10, 99);
}

function sortThreads(threads) {
  return [...threads].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    if (left.heat !== right.heat) {
      return right.heat - left.heat;
    }

    return (
      new Date(right.lastActivityAt || right.createdAt).getTime() -
      new Date(left.lastActivityAt || left.createdAt).getTime()
    );
  });
}

function threadsForRoom(roomId) {
  return boardState.threads
    .filter((thread) => thread.room === roomId)
    .map((thread) => decorateThread(thread));
}

function threadsForPolitician(politicianId) {
  return boardState.threads
    .filter((thread) => thread.targetType === "politician" && thread.targetId === politicianId)
    .map((thread) => decorateThread(thread));
}

function relatedThreadsForThread(thread) {
  const related = boardState.threads.filter((item) => item.id !== thread.id);
  const sameTarget = related.filter(
    (item) =>
      thread.targetType &&
      item.targetType === thread.targetType &&
      item.targetId === thread.targetId &&
      item.targetLabel === thread.targetLabel
  );
  const sameRoom = related.filter(
    (item) => item.room === thread.room && !sameTarget.some((target) => target.id === item.id)
  );

  return sortThreads([...sameTarget, ...sameRoom].map((item) => decorateThread(item))).slice(0, 5);
}

function findRoom(roomId) {
  return roomDefinitions.find((room) => room.id === roomId) || null;
}

function findPolitician(politicianId) {
  return politicianDefinitions.find((politician) => politician.id === politicianId) || null;
}

function latestPoliticianVerificationDate() {
  return politicianDefinitions.map((politician) => politician.verifiedAt).sort().at(-1) || null;
}

function totalCommentCount() {
  return Object.values(boardState.comments).reduce((sum, comments) => sum + comments.length, 0);
}

function nextAllowedAt(key, cooldownMs) {
  const lastActionAt = boardState.rateLimits.get(key);

  if (!lastActionAt) {
    return null;
  }

  const nextAllowed = lastActionAt + cooldownMs;
  if (Date.now() >= nextAllowed) {
    return null;
  }

  return new Date(nextAllowed).toISOString();
}

function actionFingerprint(request, author, scope) {
  return `${scope}:${request.ip}:${author.toLowerCase()}`;
}

function normalizeTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\n、]/)
        .map((item) => item.trim());

  const unique = [];

  for (const item of raw) {
    const tag = normalizeText(item).replace(/^#/, "");
    if (!tag || unique.includes(tag)) {
      continue;
    }

    unique.push(tag.slice(0, 20));
  }

  return unique;
}

function normalizeImpactAreas(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const allowed = new Set(impactDefinitions.map((item) => item.id));
  return [...new Set(values.map((item) => normalizeText(item)).filter((item) => allowed.has(item)))];
}

function defaultImpactsForRoom(roomId) {
  const defaults = {
    money: ["rights", "future"],
    tax: ["household", "future"],
    prices: ["household", "work"],
    boj: ["household", "work"],
    security: ["security", "future"],
    election: ["rights", "region"],
  };
  return defaults[roomId] || ["future"];
}

function normalizeThreadTarget(value) {
  const targetType = normalizeText(value?.targetType);
  if (!targetDefinitions.some((definition) => definition.id === targetType)) {
    return null;
  }

  if (targetType === "politician") {
    const politician = findPolitician(normalizeText(value?.targetId));
    if (!politician) {
      return null;
    }

    return {
      targetType,
      targetId: politician.id,
      targetLabel: politician.name,
    };
  }

  const targetLabel = normalizeText(value?.targetLabel).slice(0, 60);
  if (targetLabel.length < 2) {
    return null;
  }

  return {
    targetType,
    targetId: makeId(`${targetType}:${targetLabel.toLowerCase()}`),
    targetLabel,
  };
}

function resolveThreadTarget(thread) {
  const definition = targetDefinitions.find((item) => item.id === thread.targetType);
  if (!definition) {
    return null;
  }

  const politician = thread.targetType === "politician" ? findPolitician(thread.targetId) : null;

  return {
    type: thread.targetType,
    typeLabel: definition.label,
    id: thread.targetId || "",
    label: politician?.name || thread.targetLabel || "",
    href: politician ? `/politician/${politician.id}` : "",
  };
}

function emptyReactionCounts() {
  return Object.fromEntries(reactionDefinitions.map((definition) => [definition.id, 0]));
}

function emptyPositionCounts() {
  return Object.fromEntries(positionDefinitions.map((definition) => [definition.id, 0]));
}

function normalizePositionCounts(value) {
  const counts = emptyPositionCounts();
  if (!value || Array.isArray(value) || typeof value !== "object") return counts;
  for (const definition of positionDefinitions) {
    counts[definition.id] = clamp(Math.floor(Number(value[definition.id]) || 0), 0, 1_000_000);
  }
  return counts;
}

function emptyHelpfulnessCounts() {
  return Object.fromEntries(helpfulnessDefinitions.map((definition) => [definition.id, 0]));
}

function normalizeHelpfulnessCounts(value) {
  const counts = emptyHelpfulnessCounts();
  if (!value || Array.isArray(value) || typeof value !== "object") return counts;
  for (const definition of helpfulnessDefinitions) {
    counts[definition.id] = clamp(Math.floor(Number(value[definition.id]) || 0), 0, 1_000_000);
  }
  return counts;
}

function normalizeComment(comment, thread) {
  const stance = positionDefinitions.some((item) => item.id === comment.stance)
    ? comment.stance
    : "unsure";
  const claimType = claimDefinitions.some((item) => item.id === comment.claimType)
    ? comment.claimType
    : "opinion";
  return {
    ...comment,
    stance,
    claimType,
    impactAreas: normalizeImpactAreas(comment.impactAreas).length
      ? normalizeImpactAreas(comment.impactAreas)
      : defaultImpactsForRoom(thread?.room),
    sourceUrl: normalizeUrl(comment.sourceUrl),
    helpfulness: normalizeHelpfulnessCounts(comment.helpfulness),
  };
}

function normalizeReactionCounts(value) {
  const counts = emptyReactionCounts();

  if (!value || Array.isArray(value) || typeof value !== "object") {
    return counts;
  }

  for (const definition of reactionDefinitions) {
    counts[definition.id] = clamp(Math.floor(Number(value[definition.id]) || 0), 0, 1_000_000);
  }

  if (!("concern" in value)) counts.concern = clamp(Number(value.impact || 0), 0, 1_000_000);
  if (!("hope" in value)) counts.hope = clamp(Number(value.agree || 0), 0, 1_000_000);
  if (!("curious" in value)) counts.curious = clamp(Number(value.source || 0), 0, 1_000_000);

  return counts;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  const input = normalizeText(value);
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function makeId(seed) {
  return crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 12);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadBoard() {
  const loadedThreads = await readJson(THREADS_FILE, null);
  const loadedComments = await readJson(COMMENTS_FILE, null);
  const loadedReports = await readJson(REPORTS_FILE, null);
  const seeded = seedBoard();

  if (
    !Array.isArray(loadedThreads) ||
    !loadedComments ||
    !Array.isArray(loadedReports) ||
    isLegacyThreadShape(loadedThreads)
  ) {
    boardState.threads = seeded.threads.map((thread) => migrateThread(thread, thread));
    boardState.comments = migrateComments(seeded.comments, boardState.threads);
    boardState.reports = seeded.reports;
    await persistBoard();
    return;
  }

  const seedThreadsById = new Map(seeded.threads.map((thread) => [thread.id, thread]));
  const migratedThreads = loadedThreads.map((thread) =>
    migrateThread(thread, seedThreadsById.get(thread.id))
  );
  const missingFeatureSeeds = seeded.threads.filter(
    (thread) =>
      ["takaichi-policy-001", "tamaki-session-001"].includes(thread.id) &&
      !migratedThreads.some((item) => item.id === thread.id)
  );

  boardState.threads = [...migratedThreads, ...missingFeatureSeeds];
  boardState.comments = migrateComments(loadedComments, boardState.threads);
  for (const thread of missingFeatureSeeds) {
    boardState.comments[thread.id] = seeded.comments[thread.id] || [];
  }
  boardState.reports = loadedReports;
  const requiresMigration =
    JSON.stringify(boardState.threads) !== JSON.stringify(loadedThreads) ||
    JSON.stringify(boardState.comments) !== JSON.stringify(loadedComments);

  if (requiresMigration) {
    await persistBoard();
  } else {
    boardState.lastSavedAt = await readLatestStorageTimestamp();
  }
}

function migrateComments(commentsByThread, threads) {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  return Object.fromEntries(
    Object.entries(commentsByThread || {}).map(([threadId, comments]) => [
      threadId,
      (Array.isArray(comments) ? comments : []).map((comment) =>
        normalizeComment(comment, threadsById.get(threadId))
      ),
    ])
  );
}

function migrateThread(thread, fallback = {}) {
  const targetType = targetDefinitions.some((item) => item.id === thread.targetType)
    ? thread.targetType
    : fallback.targetType || "policy";
  const targetLabel = normalizeText(
    thread.targetLabel || fallback.targetLabel || thread.tags?.[0] || findRoom(thread.room)?.label
  );

  const legacyPositions = {
    support: Number(thread.reactions?.agree || fallback.reactions?.agree || 0),
    oppose: Number(thread.reactions?.oppose || fallback.reactions?.oppose || 0),
    unsure: Number(thread.reactions?.source || fallback.reactions?.source || 0),
  };
  const storedPositions = normalizePositionCounts(thread.positions || fallback.positions);
  const migratedPositions = Object.values(storedPositions).some((count) => count > 0)
    ? storedPositions
    : legacyPositions;

  return {
    ...thread,
    sourceUrl: thread.sourceUrl || fallback.sourceUrl || "",
    targetType,
    targetId:
      thread.targetId || fallback.targetId || makeId(`${targetType}:${targetLabel.toLowerCase()}`),
    targetLabel,
    reactions: normalizeReactionCounts(thread.reactions || fallback.reactions),
    positions: normalizePositionCounts(migratedPositions),
    decisionPrompt:
      normalizeText(thread.decisionPrompt || fallback.decisionPrompt) ||
      `${targetLabel}について、生活への影響を踏まえてどう判断するべきか。`,
    impactAreas: normalizeImpactAreas(thread.impactAreas).length
      ? normalizeImpactAreas(thread.impactAreas)
      : normalizeImpactAreas(fallback.impactAreas).length
        ? normalizeImpactAreas(fallback.impactAreas)
        : defaultImpactsForRoom(thread.room),
    sourceKind: ["official", "news", "analysis", "other"].includes(thread.sourceKind)
      ? thread.sourceKind
      : "official",
  };
}

function isLegacyThreadShape(threads) {
  if (!threads.length) {
    return true;
  }

  return threads.some(
    (thread) =>
      thread.sourceId ||
      thread.sourceName ||
      typeof thread.summary !== "string" ||
      typeof thread.body !== "string"
  );
}

function seedBoard() {
  const now = Date.now();
  const createTime = (hoursAgo) => new Date(now - hoursAgo * 36e5).toISOString();

  const threads = [
    {
      id: "money-mega",
      room: "money",
      author: "運営",
      title: "政治資金規正法 再改正を追うメガスレ",
      summary:
        "献金、パーティー券、監査のどこを塞がないと意味がないのかを継続追跡する総合スレ。",
      body:
        "不祥事そのものの怒りだけでなく、支部経由、監査、公開基準、第三者機関まで分けて議論する。単発ニュースはここへ集約し、重複スレは整理する。",
      sourceUrl: "https://elaws.e-gov.go.jp/document?lawid=323AC1000000194",
      tags: ["政治資金", "献金", "監査"],
      targetType: "policy",
      targetId: "political-funds-control-act",
      targetLabel: "政治資金規正法",
      reactions: { agree: 2, oppose: 1, source: 2, important: 4, impact: 1, angry: 5 },
      createdAt: createTime(18),
      updatedAt: createTime(1.5),
      lastCommentAt: createTime(1.5),
      megathread: true,
      pinned: true,
      locked: false,
      slowModeSeconds: 60,
      moderationNote: "継続炎上テーマのため slow mode 60 秒。",
    },
    {
      id: "tax-001",
      room: "tax",
      author: "mod_tax",
      title: "消費税減税をやるなら何を削るべきか",
      summary:
        "減税賛成/反対ではなく、財源と対象期間と受益層の線引きを先に決めるための議論。",
      body:
        "恒久減税、時限減税、給付、社会保険料軽減のどれが実際に家計へ効くのか。誰が得して誰が漏れるのかを、感情ではなく設計で話す。",
      sourceUrl: "https://www.mof.go.jp/tax_policy/summary/consumption/index.htm",
      tags: ["減税", "消費税", "財源"],
      targetType: "policy",
      targetId: "consumption-tax",
      targetLabel: "消費税",
      reactions: { agree: 3, oppose: 2, source: 1, important: 4, impact: 6, angry: 2 },
      createdAt: createTime(9),
      updatedAt: createTime(0.4),
      lastCommentAt: createTime(0.4),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 0,
      moderationNote: "未設定",
    },
    {
      id: "prices-001",
      room: "prices",
      author: "名無しさん",
      title: "物価高なのに賃上げ実感が弱い理由を分解する",
      summary:
        "名目賃金のニュースと生活実感が噛み合わない理由を、固定費、食料、雇用形態で分ける。",
      body:
        "統計の平均だけでなく、中小企業、非正規、住居費の違いまで見ないと生活感覚は拾えない。家計簿ベースの実感を書いてもいいが、どの費目が効いているかは明記する。",
      sourceUrl: "https://www.stat.go.jp/data/cpi/",
      tags: ["物価高", "実質賃金", "家計"],
      targetType: "economy",
      targetId: "consumer-prices",
      targetLabel: "消費者物価",
      reactions: { agree: 4, oppose: 0, source: 1, important: 3, impact: 7, angry: 3 },
      createdAt: createTime(6),
      updatedAt: createTime(2.2),
      lastCommentAt: createTime(2.2),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 0,
      moderationNote: "未設定",
    },
    {
      id: "boj-mega",
      room: "boj",
      author: "運営",
      title: "円安・日銀・株価の因果を追うメガスレ",
      summary:
        "円安、利上げ観測、輸入物価、株価の動きを1本で追う定点スレ。単発相場実況はここへ寄せる。",
      body:
        "為替だけ、株だけ、日銀だけに切らず、家計、企業、投資家の3方向で議論する。短時間の連投で相場実況化しやすいので slow mode を入れる。",
      sourceUrl: "https://www.boj.or.jp/mopo/index.htm",
      tags: ["円安", "日銀", "株価", "金利"],
      targetType: "economy",
      targetId: "monetary-policy",
      targetLabel: "金融政策",
      reactions: { agree: 2, oppose: 2, source: 2, important: 5, impact: 4, angry: 1 },
      createdAt: createTime(12),
      updatedAt: createTime(0.2),
      lastCommentAt: createTime(0.2),
      megathread: true,
      pinned: true,
      locked: false,
      slowModeSeconds: 45,
      moderationNote: "実況化しやすいので slow mode 45 秒。",
    },
    {
      id: "security-001",
      room: "security",
      author: "analysis_user",
      title: "防衛費増額は家計負担と両立するのか",
      summary:
        "安全保障の必要性は前提にした上で、税、国債、歳出削減のどこで賄うのかを議論する。",
      body:
        "外交・安全保障は陣営論に流れやすい。だから費用負担、時間軸、エネルギー価格への波及までセットで話す。人格攻撃や国籍ヘイトは即通報対象。",
      sourceUrl: "https://www.mod.go.jp/j/policy/agenda/guideline/",
      tags: ["防衛費", "安全保障", "税負担"],
      targetType: "policy",
      targetId: "defense-spending",
      targetLabel: "防衛費",
      reactions: { agree: 2, oppose: 3, source: 3, important: 4, impact: 2, angry: 2 },
      createdAt: createTime(8),
      updatedAt: createTime(3.2),
      lastCommentAt: createTime(3.2),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 30,
      moderationNote: "過熱しやすいので slow mode 30 秒。",
    },
    {
      id: "election-001",
      room: "election",
      author: "watcher",
      title: "次の参院選で本当に効く争点は何か",
      summary:
        "支持率だけでなく、物価、政治資金、候補者の地盤、無党派の動きで争点を整理する。",
      body:
        "政党支持の表明だけではなく、どの争点がどの選挙区で効くのかを書いていく。候補者個人の情報は公知の範囲に限定し、私人情報は不可。",
      sourceUrl: "https://www.soumu.go.jp/senkyo/senkyo_s/index.html",
      tags: ["選挙", "支持率", "無党派"],
      targetType: "policy",
      targetId: "national-election",
      targetLabel: "国政選挙",
      reactions: { agree: 1, oppose: 1, source: 2, important: 5, impact: 2, angry: 1 },
      createdAt: createTime(10),
      updatedAt: createTime(5.1),
      lastCommentAt: createTime(5.1),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 0,
      moderationNote: "未設定",
    },
    {
      id: "takaichi-policy-001",
      room: "election",
      author: "政策ウォッチ",
      title: "高市早苗議員の施政方針、家計に効く部分を読む",
      summary:
        "施政方針演説に含まれる経済、物価、社会保障の方針を一次資料から読み、生活への影響を分けて考える。",
      body:
        "人物への好き嫌いだけで終わらせず、施政方針演説のどの記述が家計、雇用、税負担にどう効くのかを追う。主張を断定するときは該当箇所を示す。",
      sourceUrl: "https://www.kantei.go.jp/jp/105/statement/2026/0220shiseihoshin.html",
      tags: ["高市早苗", "施政方針", "経済政策"],
      targetType: "politician",
      targetId: "takaichi-sanae",
      targetLabel: "高市 早苗",
      reactions: { agree: 2, oppose: 3, source: 1, important: 5, impact: 4, angry: 1 },
      createdAt: createTime(4),
      updatedAt: createTime(1.2),
      lastCommentAt: createTime(1.2),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 30,
      moderationNote: "人物論に流れやすいため slow mode 30 秒。",
    },
    {
      id: "tamaki-session-001",
      room: "tax",
      author: "国会ログ",
      title: "玉木雄一郎議員の代表質問、負担軽減策を検証する",
      summary:
        "本会議の代表質問を入口に、税と社会保険の負担軽減策が誰にどこまで届くのかを検証する。",
      body:
        "会議録の発言を起点に、賛否だけでなく対象者、財源、実施時期を確認する。切り抜きではなく前後の文脈も参照する。",
      sourceUrl: "https://www.shugiin.go.jp/internet/itdb_kaigiroku.nsf/html/kaigiroku/000122120260225004.htm",
      tags: ["玉木雄一郎", "代表質問", "負担軽減"],
      targetType: "politician",
      targetId: "tamaki-yuichiro",
      targetLabel: "玉木 雄一郎",
      reactions: { agree: 4, oppose: 2, source: 1, important: 4, impact: 5, angry: 1 },
      createdAt: createTime(5),
      updatedAt: createTime(2),
      lastCommentAt: createTime(2),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 15,
      moderationNote: "議論速度を整えるため slow mode 15 秒。",
    },
  ];

  const comments = {
    "money-mega": [
      {
        id: "c-money-1",
        author: "名無しさん",
        body: "公開基準を厳しくしても支部経由の抜け道が残るなら意味が薄い。監査の独立性まで必要。",
        createdAt: createTime(1.5),
      },
      {
        id: "c-money-2",
        author: "調査班",
        body: "企業献金そのものより、公開頻度と監査体制をどう変えるかが本体だと思う。",
        createdAt: createTime(4),
      },
    ],
    "tax-001": [
      {
        id: "c-tax-1",
        author: "名無しさん",
        body: "時限減税ならまだ議論できるが、恒久減税なら社会保険をどうするかまで避けられない。",
        createdAt: createTime(0.4),
      },
      {
        id: "c-tax-2",
        author: "生活者",
        body: "給付は届くのが遅い。減税の方が早いけど、低所得層への届き方が弱いのが難点。",
        createdAt: createTime(1.1),
      },
      {
        id: "c-tax-3",
        author: "財源厨",
        body: "何を削るかを言わずに減税だけ叫ぶ話はこのスレでは切り分けたい。",
        createdAt: createTime(2.5),
      },
    ],
    "prices-001": [
      {
        id: "c-prices-1",
        author: "家計簿勢",
        body: "食料だけじゃなくて家賃更新と保険料が重い。名目賃金のニュースとズレるのはそこ。",
        createdAt: createTime(2.2),
      },
    ],
    "boj-mega": [
      {
        id: "c-boj-1",
        author: "相場民",
        body: "円安が家計に効く速度と株価に効く速度が違うから、感情だけで利上げ賛否を決めにくい。",
        createdAt: createTime(0.2),
      },
      {
        id: "c-boj-2",
        author: "名無しさん",
        body: "輸入物価だけじゃなく住宅ローン側も見るべき。ここは実況より整理を優先したい。",
        createdAt: createTime(0.8),
      },
    ],
    "security-001": [
      {
        id: "c-sec-1",
        author: "名無しさん",
        body: "防衛費の必要性を認めても、どの税で払うのかが曖昧なままだと支持は続かない。",
        createdAt: createTime(3.2),
      },
    ],
    "election-001": [
      {
        id: "c-ele-1",
        author: "watcher",
        body: "都市部は物価、地方は社会保険と候補者地盤の話が強い印象。全部同じ争点ではない。",
        createdAt: createTime(5.1),
      },
    ],
    "takaichi-policy-001": [
      {
        id: "c-takaichi-1",
        author: "家計目線",
        body: "成長投資の話と、短期の物価負担を軽くする話は分けて評価したい。",
        createdAt: createTime(1.2),
      },
    ],
    "tamaki-session-001": [
      {
        id: "c-tamaki-1",
        author: "制度確認中",
        body: "負担軽減の対象範囲と恒久財源が同時に示されているかを会議録で追いたい。",
        createdAt: createTime(2),
      },
    ],
  };

  const reports = [
    {
      id: "report-seed-1",
      targetType: "comment",
      threadId: "security-001",
      targetId: "c-sec-1",
      reason: "その他",
      details: "線引きの参考として保留中のダミー通報。",
      reporter: "seed",
      status: "pending",
      createdAt: createTime(2.4),
      resolvedAt: null,
      resolutionNote: "",
    },
  ];

  return { threads, comments, reports };
}

async function persistBoard() {
  await fs.writeFile(THREADS_FILE, `${JSON.stringify(boardState.threads, null, 2)}\n`, "utf8");
  await fs.writeFile(COMMENTS_FILE, `${JSON.stringify(boardState.comments, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORTS_FILE, `${JSON.stringify(boardState.reports, null, 2)}\n`, "utf8");
  boardState.lastSavedAt = new Date().toISOString();
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function readLatestStorageTimestamp() {
  const timestamps = [];

  for (const filePath of [THREADS_FILE, COMMENTS_FILE, REPORTS_FILE]) {
    try {
      const stat = await fs.stat(filePath);
      timestamps.push(stat.mtime.toISOString());
    } catch {
      // ignore missing files
    }
  }

  return timestamps.sort().at(-1) || null;
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
