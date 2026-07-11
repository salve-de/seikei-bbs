import seedComments from "../data/comments.json";
import politicians from "../data/politicians.json";
import seedThreads from "../data/threads.json";

const rooms = [
  { id: "money", label: "政治とカネ", note: "汚職、献金、不祥事", prompt: "人ではなく制度、流れ、抜け道に寄せて議論する。", suggestedTags: ["政治資金", "献金", "裏金", "監査"] },
  { id: "tax", label: "税と社会保険", note: "減税、給付、負担", prompt: "家計、財源、受益層、時間軸に分ける。", suggestedTags: ["減税", "給付", "社会保険", "消費税"] },
  { id: "prices", label: "物価と家計", note: "物価、賃金、生活", prompt: "実感、統計、雇用の3本で議論する。", suggestedTags: ["物価高", "実質賃金", "家計", "雇用"] },
  { id: "boj", label: "日銀・相場", note: "円安、金利、株価", prompt: "為替、金利、企業収益、家計負担を切り分ける。", suggestedTags: ["日銀", "円安", "株価", "金利"] },
  { id: "security", label: "外交安全保障", note: "地政学、資源、外交", prompt: "安全保障だけでなく、エネルギーと物流まで戻す。", suggestedTags: ["安全保障", "外交", "防衛費", "資源"] },
  { id: "election", label: "選挙・政局", note: "支持率、候補者、国会", prompt: "雰囲気論ではなく、争点が議席にどう効くかを見る。", suggestedTags: ["選挙", "支持率", "国会", "政局"] },
];
const targets = [{ id: "policy", label: "政策" }, { id: "politician", label: "議員" }, { id: "party", label: "政党・会派" }, { id: "district", label: "選挙区・地域" }, { id: "economy", label: "経済指標・市場" }];
const reactions = [{ id: "concern", label: "不安", tone: "concern" }, { id: "angry", label: "怒り", tone: "angry" }, { id: "hope", label: "期待", tone: "hope" }, { id: "curious", label: "疑問", tone: "curious" }];
const positions = [{ id: "support", label: "賛成寄り" }, { id: "oppose", label: "反対寄り" }, { id: "unsure", label: "判断保留" }];
const impacts = [{ id: "household", label: "家計" }, { id: "work", label: "仕事" }, { id: "region", label: "地域" }, { id: "future", label: "将来" }, { id: "rights", label: "権利・制度" }, { id: "security", label: "安全" }];
const claims = [{ id: "experience", label: "自分の体験" }, { id: "opinion", label: "意見・予想" }, { id: "fact", label: "事実・データ" }, { id: "question", label: "質問" }];
const helpfulness = [{ id: "useful", label: "参考になった" }, { id: "changed", label: "見方が変わった" }, { id: "weak", label: "根拠が弱い" }];
const commentReactions = [{ id: "agree", label: "わかる" }, { id: "laugh", label: "草" }, { id: "disagree", label: "いや違う" }, { id: "source", label: "ソースは？" }];
const schemas = [
  "CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS comments_thread_id_idx ON comments (thread_id, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rate_limits (fingerprint TEXT PRIMARY KEY, last_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS thread_counters (thread_id TEXT PRIMARY KEY, next_comment_no INTEGER NOT NULL)",
];

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const cleanBody = (value) => String(value || "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const safeUrl = (value) => { try { const url = new URL(clean(value)); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; } };
const counts = (defs, value = {}) => Object.fromEntries(defs.map((item) => [item.id, clamp(Math.floor(Number(value?.[item.id]) || 0), 0, 1000000)]));
const validImpacts = (value) => [...new Set((Array.isArray(value) ? value : []).map(clean).filter((id) => impacts.some((item) => item.id === id)))];
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

async function initialize(env) {
  await env.DB.batch(schemas.map((sql) => env.DB.prepare(sql)));
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM threads").first();
  if (Number(row?.count || 0) > 0) return;
  const statements = seedThreads.map((thread) => env.DB.prepare("INSERT INTO threads (id, payload, created_at) VALUES (?, ?, ?)").bind(thread.id, JSON.stringify(thread), thread.createdAt));
  for (const [threadId, comments] of Object.entries(seedComments)) {
    for (const comment of comments) statements.push(env.DB.prepare("INSERT INTO comments (id, thread_id, payload, created_at) VALUES (?, ?, ?, ?)").bind(comment.id, threadId, JSON.stringify(comment), comment.createdAt));
  }
  if (statements.length) await env.DB.batch(statements);
}

async function loadState(env) {
  await initialize(env);
  const [threadRows, commentRows] = await env.DB.batch([
    env.DB.prepare("SELECT payload FROM threads"),
    env.DB.prepare("SELECT thread_id, payload FROM comments ORDER BY created_at ASC"),
  ]);
  const threads = threadRows.results.map((row) => JSON.parse(row.payload));
  const comments = Object.fromEntries(threads.map((thread) => [thread.id, []]));
  for (const row of commentRows.results) (comments[row.thread_id] ||= []).push(JSON.parse(row.payload));
  for (const thread of threads) {
    const threadComments = comments[thread.id] || [];
    const used = new Set(threadComments.map((comment) => Number(comment.number || 0)).filter((number) => number > 0));
    let next = used.size ? Math.max(...used) + 1 : 1;
    for (const comment of threadComments) {
      if (!Number(comment.number || 0)) { comment.number = next; used.add(next); next += 1; }
    }
    const byId = new Map(threadComments.map((comment) => [comment.id, comment]));
    for (const comment of threadComments) {
      comment.replyToNumber = byId.get(comment.replyToId)?.number || comment.replyToNumber || null;
      comment.quotedNumbers = Array.isArray(comment.quotedNumbers) ? comment.quotedNumbers : [...cleanBody(comment.body).matchAll(/>>\s*(\d+)/g)].map((match) => Number(match[1])).filter((number, index, values) => used.has(number) && values.indexOf(number) === index);
    }
    thread.lastCommentNo = used.size ? Math.max(...used) : 0;
  }
  return { threads, comments };
}

function targetFor(thread) {
  const definition = targets.find((item) => item.id === thread.targetType);
  if (!definition) return null;
  const politician = thread.targetType === "politician" ? politicians.find((item) => item.id === thread.targetId) : null;
  return { type: thread.targetType, typeLabel: definition.label, id: thread.targetId || "", label: politician?.name || thread.targetLabel || "", href: politician ? `/politician/${politician.id}` : "" };
}

function decorateComment(comment) {
  const signalCounts = counts(helpfulness, comment.helpfulness);
  const reactionCounts = counts(commentReactions, comment.reactions);
  const { actorHash: _actorHash, ...visible } = comment;
  return { ...visible, schemaVersion: 2, number: Math.max(0, Math.floor(Number(comment.number) || 0)), stance: positions.some((item) => item.id === comment.stance) ? comment.stance : "", claimType: claims.some((item) => item.id === comment.claimType) ? comment.claimType : "", impactAreas: validImpacts(comment.impactAreas), sourceUrl: safeUrl(comment.sourceUrl), replyToId: clean(comment.replyToId) || null, replyToNumber: Math.max(0, Math.floor(Number(comment.replyToNumber) || 0)) || null, quotedNumbers: Array.isArray(comment.quotedNumbers) ? [...new Set(comment.quotedNumbers.map(Number).filter((number) => Number.isInteger(number) && number > 0))] : [], reactions: commentReactions.map((item) => ({ ...item, count: reactionCounts[item.id] })), helpfulness: helpfulness.map((item) => ({ ...item, count: signalCounts[item.id] })), pendingReportsCount: 0 };
}

function decorateThread(thread, state) {
  const rawComments = state.comments[thread.id] || [];
  const comments = rawComments.map(decorateComment);
  const reactionCounts = counts(reactions, thread.reactions);
  const positionCounts = counts(positions, thread.positions);
  const mappedReactions = reactions.map((item) => ({ ...item, count: reactionCounts[item.id] }));
  const mappedPositions = positions.map((item) => ({ ...item, count: positionCounts[item.id] }));
  const lastActivityAt = comments.at(-1)?.createdAt || thread.updatedAt || thread.createdAt;
  const evidenceRate = Math.round((1 + comments.filter((item) => item.sourceUrl).length) / (comments.length + 1) * 100);
  const stanceDiversity = new Set(comments.map((item) => item.stance)).size;
  const value = clamp(24 + (thread.tags?.length || 0) * 5 + comments.length * 2 + (thread.sourceUrl ? 8 : 0) + (thread.decisionPrompt ? 10 : 0) + validImpacts(thread.impactAreas).length * 4 + comments.filter((item) => item.sourceUrl).length * 5 + (stanceDiversity > 1 ? 8 : 0), 10, 99);
  const ageHours = Math.max(0, (Date.now() - new Date(lastActivityAt).getTime()) / 36e5);
  const participants = new Set(rawComments.map((comment) => comment.actorHash || comment.displayId || comment.author || comment.id)); const byId = new Map(rawComments.map((comment) => [comment.id, comment])); const directReplyCount = rawComments.filter((comment) => comment.replyToId && byId.has(comment.replyToId)).length; const crossStanceReplyCount = rawComments.filter((comment) => { const parent = byId.get(comment.replyToId); return parent?.stance && comment.stance && parent.stance !== comment.stance; }).length;
  const boundedComments = Math.min(comments.length, Math.max(1, participants.size) * 3); const heat = clamp(Math.round(34 + Math.max(0, 42 - ageHours * 5) + boundedComments * 3 + Math.min(participants.size, 12) * 4 + Math.min(directReplyCount, 10) * 2 + Math.min(mappedReactions.reduce((sum, item) => sum + item.count, 0), 10) + (thread.pinned ? 10 : 0) + (thread.megathread ? 8 : 0)), 5, 99);
  return { ...thread, target: targetFor(thread), reactions: mappedReactions, reactionTotal: mappedReactions.reduce((sum, item) => sum + item.count, 0), positions: mappedPositions, positionTotal: mappedPositions.reduce((sum, item) => sum + item.count, 0), impactAreas: validImpacts(thread.impactAreas), evidenceRate, bridgeSignals: comments.reduce((sum, item) => sum + (item.helpfulness.find((signal) => signal.id === "changed")?.count || 0), 0), participantCount: participants.size, directReplyCount, crossStanceReplyCount, arguingScore: participants.size * 3 + directReplyCount * 5 + crossStanceReplyCount * 8, latestExcerpt: clean(rawComments.at(-1)?.body).slice(0, 120), commentCount: comments.length, lastActivityAt, pendingReportsCount: 0, heat, freshness: clamp(Math.round(100 - ageHours * 8), 8, 100), value };
}

const sortThreads = (threads) => [...threads].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.heat - a.heat || new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

function decoratePolitician(politician, decoratedThreads) {
  const related = decoratedThreads.filter((thread) => thread.targetType === "politician" && thread.targetId === politician.id);
  const commentCount = related.reduce((sum, thread) => sum + thread.commentCount, 0);
  const reactionCount = related.reduce((sum, thread) => sum + thread.reactionTotal, 0);
  return { ...politician, threadCount: related.length, commentCount, reactionCount, activityCount: related.length + commentCount + reactionCount, latestActivityAt: related.map((item) => item.lastActivityAt).sort().at(-1) || null };
}

function boardPayload(state) {
  const decorated = state.threads.map((thread) => decorateThread(thread, state));
  return { rooms, threads: decorated, politicians: politicians.map((item) => decoratePolitician(item, decorated)), targetDefinitions: targets, reactionDefinitions: reactions, positionDefinitions: positions, impactDefinitions: impacts, claimDefinitions: claims, moderation: { pendingReports: 0, lockedThreads: decorated.filter((item) => item.locked).length, slowedThreads: decorated.filter((item) => item.slowModeSeconds).length, megathreads: decorated.filter((item) => item.megathread).length }, meta: { totalThreads: decorated.length, totalComments: decorated.reduce((sum, item) => sum + item.commentCount, 0), totalTags: [] } };
}

function homePayload(state) {
  const board = boardPayload(state);
  const sorted = sortThreads(board.threads);
  const roomPayloads = rooms.map((room) => { const roomThreads = sortThreads(board.threads.filter((thread) => thread.room === room.id)); return { ...room, threadCount: roomThreads.length, commentCount: roomThreads.reduce((sum, item) => sum + item.commentCount, 0), pendingReportsCount: 0, latestActivityAt: roomThreads[0]?.lastActivityAt || null, hotThread: roomThreads[0] || null, topTags: [] }; });
  const boardDefs = [{ id: "politics", label: "政治総合", note: "政局、選挙、政治とカネ、安全保障", roomIds: ["money", "security", "election"] }, { id: "economy", label: "生活と経済", note: "税、物価、賃金、日銀、相場", roomIds: ["tax", "prices", "boj"] }, { id: "live", label: "実況・速報", note: "会見、国会、選挙、指標発表をその場で", roomIds: [] }]; const boards = boardDefs.map((definition) => { const threads = sorted.filter((thread) => definition.roomIds.includes(thread.room)); return { ...definition, threadCount: threads.length, commentCount: threads.reduce((sum, thread) => sum + thread.commentCount, 0), hotThread: threads[0] || null }; });
  return { boards, rooms: roomPayloads, featured: { dailyIssues: [...sorted].sort((a, b) => b.value - a.value || b.heat - a.heat).slice(0, 6), hotThreads: sorted.slice(0, 8), groundedThreads: [...sorted].sort((a, b) => b.evidenceRate - a.evidenceRate || b.value - a.value).slice(0, 6), bridgingThreads: [...sorted].sort((a, b) => b.bridgeSignals - a.bridgeSignals || b.value - a.value).slice(0, 6), newestThreads: [...sorted].sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt)).slice(0, 8), arguingThreads: [...sorted].filter((thread) => thread.participantCount > 1 && thread.directReplyCount > 0).sort((a, b) => b.arguingScore - a.arguingScore || b.heat - a.heat).slice(0, 8), megathreads: sorted.filter((item) => item.megathread).slice(0, 6), politicians: board.politicians.sort((a, b) => b.activityCount - a.activityCount).slice(0, 6) }, moderation: board.moderation, meta: board.meta };
}

async function limited(env, request, scope, waitMs) {
  const source = `${scope}:${request.headers.get("cf-connecting-ip") || "local"}`;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const row = await env.DB.prepare("SELECT last_at FROM rate_limits WHERE fingerprint = ?").bind(hash).first();
  if (row && Date.now() - Number(row.last_at) < waitMs) return true;
  await env.DB.prepare("INSERT INTO rate_limits (fingerprint, last_at) VALUES (?, ?) ON CONFLICT(fingerprint) DO UPDATE SET last_at = excluded.last_at").bind(hash, Date.now()).run();
  return false;
}

async function anonymousIdentity(request, threadId) {
  const token = clean(request.headers.get("x-board-actor")) || request.headers.get("cf-connecting-ip") || "anonymous";
  const encode = (value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actorHash = hex(await encode(`actor:${token}`));
  const day = new Date().toISOString().slice(0, 10);
  const displayId = hex(await encode(`display:${threadId}:${day}:${actorHash}`)).slice(0, 8).toUpperCase();
  return { actorHash, displayId };
}

async function api(request, env, pathname) {
  const state = await loadState(env);
  if (request.method === "GET" && pathname === "/api/board") return json(boardPayload(state));
  if (request.method === "GET" && pathname === "/api/home") return json(homePayload(state));
  if (request.method === "GET" && pathname === "/api/politicians") { const board = boardPayload(state); return json({ politicians: board.politicians, rooms, meta: { verifiedAt: politicians.map((item) => item.verifiedAt).filter(Boolean).sort().at(-1) || null } }); }
  if (request.method === "GET" && pathname.startsWith("/api/politicians/")) { const politician = politicians.find((item) => item.id === decodeURIComponent(pathname.split("/").pop())); if (!politician) return json({ error: "politician_not_found" }, 404); const decorated = state.threads.map((item) => decorateThread(item, state)); return json({ politician: decoratePolitician(politician, decorated), threads: sortThreads(decorated.filter((item) => item.targetType === "politician" && item.targetId === politician.id)), rooms, reactionDefinitions: reactions }); }
  if (request.method === "GET" && pathname.startsWith("/api/rooms/")) { const room = rooms.find((item) => item.id === decodeURIComponent(pathname.split("/").pop())); if (!room) return json({ error: "room_not_found" }, 404); const threads = sortThreads(state.threads.filter((item) => item.room === room.id).map((item) => decorateThread(item, state))); return json({ room: { ...room, threadCount: threads.length, commentCount: threads.reduce((sum, item) => sum + item.commentCount, 0), pendingReportsCount: 0, latestActivityAt: threads[0]?.lastActivityAt || null, megathreads: threads.filter((item) => item.megathread).length, slowedThreads: threads.filter((item) => item.slowModeSeconds).length, topTags: [] }, threads, featured: { pinnedThreads: threads.filter((item) => item.pinned).slice(0, 4), hottestThreads: threads.slice(0, 5) }, rooms, moderation: {}, meta: {} }); }
  if (request.method === "GET" && /^\/api\/threads\/[^/]+$/.test(pathname)) { const threadId = decodeURIComponent(pathname.split("/").pop()); const thread = state.threads.find((item) => item.id === threadId); if (!thread) return json({ error: "thread_not_found" }, 404); const related = state.threads.filter((item) => item.id !== threadId && (item.room === thread.room || (item.targetId && item.targetId === thread.targetId))).map((item) => decorateThread(item, state)).slice(0, 6); return json({ thread: decorateThread(thread, state), room: rooms.find((item) => item.id === thread.room), comments: state.comments[threadId].map(decorateComment), relatedThreads: related, reactionDefinitions: reactions, positionDefinitions: positions, impactDefinitions: impacts, claimDefinitions: claims, helpfulnessDefinitions: helpfulness }); }
  if (pathname.startsWith("/api/moderation")) return json({ error: "forbidden" }, 403);

  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  if (request.method === "POST" && pathname === "/api/threads") {
    if (await limited(env, request, "thread", 30000)) return json({ error: "thread_cooldown" }, 429);
    const room = clean(body.room), title = clean(body.title), text = cleanBody(body.body), summary = clean(body.summary) || text.slice(0, 240), rawSourceUrl = clean(body.sourceUrl), sourceUrl = safeUrl(body.sourceUrl), decisionPrompt = clean(body.decisionPrompt) || title, impactAreas = validImpacts(body.impactAreas), tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(/[,、]/)).map(clean).filter(Boolean))].slice(0, 4), mode = clean(body.mode) || "mixed";
    const targetType = clean(body.targetType); let targetId = clean(body.targetId), targetLabel = clean(body.targetLabel);
    if (targetType === "politician") { const politician = politicians.find((item) => item.id === targetId); if (!politician) return json({ error: "invalid_thread_target" }, 400); targetLabel = politician.name; }
    const hasTarget = Boolean(targetType || targetId || targetLabel); if (!hasTarget) { targetId = `board-${room}`; targetLabel = rooms.find((item) => item.id === room)?.label || "政治・経済"; }
    if (!rooms.some((item) => item.id === room)) return json({ error: "invalid_room" }, 400); if (title.length < 4 || title.length > 120) return json({ error: "invalid_title" }, 400); if (text.length < 2 || text.length > 4000) return json({ error: "invalid_body" }, 400); if (rawSourceUrl && !sourceUrl) return json({ error: "invalid_source_url" }, 400); if (hasTarget && (!targets.some((item) => item.id === targetType) || (!targetId && targetLabel.length < 2))) return json({ error: "invalid_thread_target" }, 400); if (impactAreas.length > 3 || !["mixed", "same-side", "opposition-welcome"].includes(mode)) return json({ error: "invalid_thread_options" }, 400);
    const now = new Date().toISOString(); const thread = { schemaVersion: 2, id: id(), room, author: clean(body.author).slice(0, 32) || "名無しさん", title: title.slice(0, 120), summary, body: text, sourceUrl, sourceKind: ["official", "news", "analysis", "other"].includes(body.sourceKind) ? body.sourceKind : "other", decisionPrompt: decisionPrompt.slice(0, 180), impactAreas, tags, mode, lastCommentNo: 0, targetType: hasTarget ? targetType : "policy", targetId, targetLabel, reactions: counts(reactions), positions: counts(positions), createdAt: now, updatedAt: now, megathread: Boolean(body.megathread), pinned: Boolean(body.megathread), locked: false, slowModeSeconds: body.megathread ? 60 : 0 };
    await env.DB.prepare("INSERT INTO threads (id, payload, created_at) VALUES (?, ?, ?)").bind(thread.id, JSON.stringify(thread), now).run(); state.threads.unshift(thread); state.comments[thread.id] = []; return json({ ok: true, thread: decorateThread(thread, state), board: boardPayload(state) }, 201);
  }

  const positionMatch = pathname.match(/^\/api\/threads\/([^/]+)\/positions$/);
  if (request.method === "POST" && positionMatch) { const thread = state.threads.find((item) => item.id === positionMatch[1]); if (!thread) return json({ error: "thread_not_found" }, 404); if (!positions.some((item) => item.id === body.position)) return json({ error: "invalid_position" }, 400); if (await limited(env, request, `position:${thread.id}`, 600000)) return json({ error: "position_cooldown" }, 429); const value = counts(positions, thread.positions); value[body.position] += 1; thread.positions = value; await env.DB.prepare("UPDATE threads SET payload = ? WHERE id = ?").bind(JSON.stringify(thread), thread.id).run(); return json({ ok: true, thread: decorateThread(thread, state) }, 201); }
  const reactionMatch = pathname.match(/^\/api\/threads\/([^/]+)\/reactions$/);
  if (request.method === "POST" && reactionMatch) { const thread = state.threads.find((item) => item.id === reactionMatch[1]); if (!thread) return json({ error: "thread_not_found" }, 404); if (!reactions.some((item) => item.id === body.reaction)) return json({ error: "invalid_reaction" }, 400); const value = counts(reactions, thread.reactions); value[body.reaction] += 1; thread.reactions = value; await env.DB.prepare("UPDATE threads SET payload = ? WHERE id = ?").bind(JSON.stringify(thread), thread.id).run(); return json({ ok: true, thread: decorateThread(thread, state) }, 201); }
  const commentMatch = pathname.match(/^\/api\/threads\/([^/]+)\/comments$/);
  if (request.method === "POST" && commentMatch) { const thread = state.threads.find((item) => item.id === commentMatch[1]); if (!thread) return json({ error: "thread_not_found" }, 404); if (thread.locked) return json({ error: "thread_locked" }, 409); const text = cleanBody(body.body), sourceUrl = safeUrl(body.sourceUrl), impactAreas = validImpacts(body.impactAreas), stance = clean(body.stance), claimType = clean(body.claimType), replyToId = clean(body.replyToId); const threadComments = state.comments[thread.id] || []; const replyTarget = replyToId ? threadComments.find((item) => item.id === replyToId) : null; if (text.length < 2 || text.length > 2000) return json({ error: "invalid_comment_body" }, 400); if (stance && !positions.some((item) => item.id === stance)) return json({ error: "invalid_comment_stance" }, 400); if (claimType && !claims.some((item) => item.id === claimType)) return json({ error: "invalid_claim_type" }, 400); if (impactAreas.length > 3) return json({ error: "invalid_impact_areas" }, 400); if (replyToId && !replyTarget) return json({ error: "invalid_reply_target" }, 400); if (await limited(env, request, `comment:${thread.id}`, Math.max(15000, Number(thread.slowModeSeconds || 0) * 1000))) return json({ error: "comment_cooldown" }, 429); const currentMax = Math.max(Number(thread.lastCommentNo || 0), ...threadComments.map((item) => Number(item.number || 0))); const counter = await env.DB.prepare("INSERT INTO thread_counters (thread_id, next_comment_no) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET next_comment_no = thread_counters.next_comment_no + 1 RETURNING next_comment_no").bind(thread.id, currentMax + 1).first(); const number = Number(counter.next_comment_no); const existingNumbers = new Set(threadComments.map((item) => Number(item.number || 0))); const quotedNumbers = [...text.matchAll(/>>\s*(\d+)/g)].map((match) => Number(match[1])).filter((value, index, values) => existingNumbers.has(value) && values.indexOf(value) === index); const identity = await anonymousIdentity(request, thread.id); const now = new Date().toISOString(); const comment = { schemaVersion: 2, id: id(), number, actorHash: identity.actorHash, displayId: identity.displayId, author: clean(body.author).slice(0, 32) || "名無しさん", body: text, stance, claimType, impactAreas, sourceUrl, replyToId: replyTarget?.id || null, replyToNumber: replyTarget?.number || null, quotedNumbers, helpfulness: counts(helpfulness), createdAt: now }; thread.lastCommentNo = number; thread.updatedAt = now; thread.lastCommentAt = now; await env.DB.batch([env.DB.prepare("INSERT INTO comments (id, thread_id, payload, created_at) VALUES (?, ?, ?, ?)").bind(comment.id, thread.id, JSON.stringify(comment), now), env.DB.prepare("UPDATE threads SET payload = ? WHERE id = ?").bind(JSON.stringify(thread), thread.id)]); threadComments.push(comment); return json({ ok: true, thread: decorateThread(thread, state), comments: threadComments.map(decorateComment) }, 201); }
  const helpfulMatch = pathname.match(/^\/api\/threads\/([^/]+)\/comments\/([^/]+)\/helpfulness$/);
  if (request.method === "POST" && helpfulMatch) { const comment = state.comments[helpfulMatch[1]]?.find((item) => item.id === helpfulMatch[2]); if (!comment) return json({ error: "comment_not_found" }, 404); if (!helpfulness.some((item) => item.id === body.signal)) return json({ error: "invalid_helpfulness" }, 400); if (await limited(env, request, `help:${comment.id}:${body.signal}`, 600000)) return json({ error: "helpfulness_cooldown" }, 429); const value = counts(helpfulness, comment.helpfulness); value[body.signal] += 1; comment.helpfulness = value; await env.DB.prepare("UPDATE comments SET payload = ? WHERE id = ?").bind(JSON.stringify(comment), comment.id).run(); return json({ ok: true, comments: state.comments[helpfulMatch[1]].map(decorateComment) }, 201); }
  const commentReactionMatch = pathname.match(/^\/api\/threads\/([^/]+)\/comments\/([^/]+)\/reactions$/);
  if (request.method === "POST" && commentReactionMatch) { const comment = state.comments[commentReactionMatch[1]]?.find((item) => item.id === commentReactionMatch[2]); if (!comment) return json({ error: "comment_not_found" }, 404); if (!commentReactions.some((item) => item.id === body.reaction)) return json({ error: "invalid_comment_reaction" }, 400); const identity = await anonymousIdentity(request, commentReactionMatch[1]); if (await limited(env, request, `comment-reaction:${comment.id}:${body.reaction}:${identity.actorHash}`, 600000)) return json({ error: "comment_reaction_cooldown" }, 429); const value = counts(commentReactions, comment.reactions); value[body.reaction] += 1; comment.reactions = value; await env.DB.prepare("UPDATE comments SET payload = ? WHERE id = ?").bind(JSON.stringify(comment), comment.id).run(); return json({ ok: true, comments: state.comments[commentReactionMatch[1]].map(decorateComment) }, 201); }
  if (request.method === "POST" && pathname === "/api/reports") { const now = new Date().toISOString(); const report = { id: id(), targetType: clean(body.targetType), threadId: clean(body.threadId), targetId: clean(body.targetId), reason: clean(body.reason), details: clean(body.details).slice(0, 400), reporter: clean(body.reporter).slice(0, 32) || "匿名通報", status: "pending", createdAt: now }; if (!["thread", "comment"].includes(report.targetType)) return json({ error: "invalid_report_target" }, 400); await env.DB.prepare("INSERT INTO reports (id, payload, created_at) VALUES (?, ?, ?)").bind(report.id, JSON.stringify(report), now).run(); return json({ ok: true }, 201); }
  return json({ error: "not_found" }, 404);
}

function assetPath(pathname) {
  if (pathname === "/favicon.ico") return "/assets/diet-chamber.jpg";
  if (pathname === "/") return "/index.html";
  if (pathname === "/new") return "/new.html";
  if (pathname === "/politicians") return "/politicians.html";
  if (pathname.startsWith("/politician/")) return "/politician.html";
  if (pathname.startsWith("/thread/")) return "/thread.html";
  if (pathname.startsWith("/room/")) return "/room.html";
  if (pathname === "/moderation") return "/index.html";
  return pathname;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url.pathname);
    const path = assetPath(url.pathname);
    return env.ASSETS.fetch(new Request(new URL(path, request.url), request));
  },
};
