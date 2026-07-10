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
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const THREADS_FILE = path.join(DATA_DIR, "threads.json");
const COMMENTS_FILE = path.join(DATA_DIR, "comments.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const THREAD_COOLDOWN_MS = 30_000;
const DEFAULT_COMMENT_COOLDOWN_MS = 15_000;
const MAX_THREAD_COUNT = 300;
const MAX_COMMENT_COUNT = 500;

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
    relatedThreads: sortThreads(
      threadsForRoom(thread.room).filter((item) => item.id !== thread.id)
    ).slice(0, 5),
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
  const megathread = Boolean(request.body?.megathread);

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
    tags,
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

  if (body.length < 2 || body.length > 1000) {
    response.status(400).json({ error: "invalid_comment_body" });
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
      hotThreads: threads.slice(0, 8),
      newestThreads: [...threads]
        .sort(
          (left, right) =>
            new Date(right.lastActivityAt || right.createdAt).getTime() -
            new Date(left.lastActivityAt || left.createdAt).getTime()
        )
        .slice(0, 8),
      megathreads: threads.filter((thread) => thread.megathread).slice(0, 6),
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

  return {
    ...thread,
    commentCount: comments.length,
    lastActivityAt,
    pendingReportsCount,
    heat: computeHeat(thread, comments.length, lastActivityAt, pendingReportsCount),
    freshness: computeFreshness(lastActivityAt),
    value: computeValue(thread, comments.length),
  };
}

function decorateComments(threadId) {
  return (boardState.comments[threadId] || []).map((comment) => ({
    ...comment,
    pendingReportsCount: boardState.reports.filter(
      (item) => item.status === "pending" && item.targetType === "comment" && item.targetId === comment.id
    ).length,
  }));
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

function computeHeat(thread, commentCount, lastActivityAt, pendingReportsCount) {
  const ageHours = Math.max(0, (Date.now() - new Date(lastActivityAt).getTime()) / 36e5);
  let score = 34;
  score += Math.max(0, 42 - ageHours * 5);
  score += commentCount * 7;
  score += thread.pinned ? 10 : 0;
  score += thread.megathread ? 8 : 0;
  score += pendingReportsCount * 2;
  return clamp(Math.round(score), 5, 99);
}

function computeFreshness(timestamp) {
  const ageHours = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 36e5);
  return clamp(Math.round(100 - ageHours * 8), 8, 100);
}

function computeValue(thread, commentCount) {
  let score = 28 + (thread.tags?.length || 0) * 8 + commentCount * 4;
  score += thread.sourceUrl ? 8 : 0;
  score += thread.megathread ? 16 : 0;
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

function findRoom(roomId) {
  return roomDefinitions.find((room) => room.id === roomId) || null;
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

  if (
    !Array.isArray(loadedThreads) ||
    !loadedComments ||
    !Array.isArray(loadedReports) ||
    isLegacyThreadShape(loadedThreads)
  ) {
    const seeded = seedBoard();
    boardState.threads = seeded.threads;
    boardState.comments = seeded.comments;
    boardState.reports = seeded.reports;
    await persistBoard();
    return;
  }

  boardState.threads = loadedThreads;
  boardState.comments = loadedComments;
  boardState.reports = loadedReports;
  boardState.lastSavedAt = await readLatestStorageTimestamp();
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
      sourceUrl: "",
      tags: ["政治資金", "献金", "監査"],
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
      sourceUrl: "",
      tags: ["減税", "消費税", "財源"],
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
      sourceUrl: "",
      tags: ["物価高", "実質賃金", "家計"],
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
      sourceUrl: "",
      tags: ["円安", "日銀", "株価", "金利"],
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
      sourceUrl: "",
      tags: ["防衛費", "安全保障", "税負担"],
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
      sourceUrl: "",
      tags: ["選挙", "支持率", "無党派"],
      createdAt: createTime(10),
      updatedAt: createTime(5.1),
      lastCommentAt: createTime(5.1),
      megathread: false,
      pinned: false,
      locked: false,
      slowModeSeconds: 0,
      moderationNote: "未設定",
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
  await fs.writeFile(THREADS_FILE, JSON.stringify(boardState.threads, null, 2), "utf8");
  await fs.writeFile(COMMENTS_FILE, JSON.stringify(boardState.comments, null, 2), "utf8");
  await fs.writeFile(REPORTS_FILE, JSON.stringify(boardState.reports, null, 2), "utf8");
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
