const {
  escapeHtml, requestJson, relativeTime, numberFormat, renderRoomTabs, renderTags,
  renderTarget, setFeedback, parseCooldown, isWatched, toggleWatch, readLocal, writeLocal,
} = window.BoardShared;

const threadId = decodeURIComponent(location.pathname.split("/").pop() || "");
const state = { board: null, detail: null, reportTarget: null, replyTo: null, lastSeen: 0, filter: "mixed" };
const impactLabels = { household: "家計", work: "仕事", region: "地域", future: "将来", rights: "権利・制度", security: "安全" };
const sourceKindLabels = { official: "公的機関", news: "報道", analysis: "解説・分析", other: "その他" };
const ids = ["roomTabs", "threadBreadcrumb", "threadBadges", "threadTitle", "threadSummary", "threadMeta", "watchButton", "reportThreadButton", "threadSource", "discussionSummary", "conversationTitle", "conversationFilter", "commentList", "commentForm", "commentStance", "commentClaimType", "commentImpacts", "commentAuthor", "commentBody", "commentSource", "commentSubmit", "commentFeedback", "replyContext", "relatedSection", "relatedThreads", "reportDialog", "reportForm", "reportTitle", "reporterName", "reportReason", "reportDetails", "reportFeedback", "closeReport"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function label(definitions, id) {
  return definitions.find((item) => item.id === id)?.label || "";
}

function renderCommentBody(body) {
  return escapeHtml(body)
    .replace(/&gt;&gt;\s*(\d+)/g, '<a class="quote-link" href="#comment-$1">&gt;&gt;$1</a>')
    .replace(/\n/g, "<br>");
}

function renderThread() {
  const { thread, room } = state.detail;
  renderRoomTabs(el.roomTabs, state.board.rooms, room.id);
  el.threadBreadcrumb.innerHTML = `<a href="/">掲示板</a><span>/</span><a href="/room/${room.id}">${escapeHtml(room.label)}</a>`;
  el.threadTitle.textContent = thread.title;
  el.conversationTitle.textContent = thread.title;
  el.threadSummary.textContent = thread.summary;
  const modeLabel = thread.mode === "same-side" ? "同じ側で話す" : thread.mode === "opposition-welcome" ? "反対意見歓迎" : "ごちゃ混ぜ";
  el.threadBadges.innerHTML = `${renderTarget(thread.target)} <span class="badge${thread.mode === "opposition-welcome" ? " badge-danger" : ""}">${modeLabel}</span> ${renderTags(thread.tags)}`;
  el.threadMeta.innerHTML = `<span>${escapeHtml(thread.author)}</span><span>${numberFormat.format(thread.commentCount)}レス</span><span>${relativeTime(thread.lastActivityAt)}</span>`;
  el.watchButton.textContent = isWatched(thread.id) ? "★" : "☆";
  el.watchButton.classList.toggle("is-active", isWatched(thread.id));
  let hostname = "出典";
  try { hostname = new URL(thread.sourceUrl).hostname.replace(/^www\./, ""); } catch {}
  el.threadSource.innerHTML = `<div><span class="source-label">話題の材料</span><strong>${escapeHtml(hostname)}</strong><p>${escapeHtml(thread.body)}</p></div>${thread.sourceUrl ? `<a class="button button-muted" href="${escapeHtml(thread.sourceUrl)}" target="_blank" rel="noreferrer">元情報</a>` : ""}`;
}

function renderComments() {
  const ownStance = readLocal("threadStances", {})[threadId] || "";
  let comments = [...state.detail.comments].sort((a, b) => a.number - b.number);
  if (state.filter === "same" && ownStance) comments = comments.filter((comment) => comment.stance === ownStance);
  if (state.filter === "opposite" && ownStance) comments = comments.filter((comment) => comment.stance && comment.stance !== ownStance);
  if (state.filter === "unspoken") comments = comments.filter((comment) => !comment.stance);
  if (state.filter === "exchange") comments = comments.filter((comment) => comment.replyToId || state.detail.comments.some((item) => item.replyToId === comment.id));
  renderConversationFilter(ownStance);
  const unread = comments.filter((comment) => comment.number > state.lastSeen).length;
  const ownCommentIds = new Set(readLocal("ownCommentIds", []));
  const repliesToMe = comments.filter((comment) => ownCommentIds.has(comment.replyToId) && comment.number > state.lastSeen);
  el.discussionSummary.textContent = unread ? `${numberFormat.format(unread)}件の未読` : `${numberFormat.format(comments.length)}レス`;
  if (!comments.length) {
    el.commentList.innerHTML = '<p class="empty-state">まだ誰も書いていません。</p>';
    return;
  }
  let unreadBoundaryShown = false;
  el.commentList.innerHTML = comments.map((comment) => {
    const stance = label(state.detail.positionDefinitions, comment.stance);
    const claim = label(state.detail.claimDefinitions, comment.claimType);
    const boundary = !unreadBoundaryShown && comment.number > state.lastSeen;
    if (boundary) unreadBoundaryShown = true;
    return `${boundary ? `<div class="unread-boundary"><span>${repliesToMe.length ? `あなたへの返信 ${repliesToMe.length}件 · ` : ""}ここから未読</span></div>` : ""}<article id="comment-${comment.number}" class="conversation-post${state.replyTo?.id === comment.id ? " is-reply-target" : ""}">
      <header class="post-meta"><a href="#comment-${comment.number}" class="post-number">${comment.number}</a><strong>${escapeHtml(comment.author || "名無しさん")}</strong>${comment.displayId ? `<code>ID:${escapeHtml(comment.displayId)}</code>` : ""}<span>${relativeTime(comment.createdAt)}</span>${stance ? `<span class="post-stance">${escapeHtml(stance)}</span>` : ""}${claim ? `<span>${escapeHtml(claim)}</span>` : ""}</header>
      ${comment.replyToNumber ? `<a class="direct-reply" href="#comment-${comment.replyToNumber}">返信先 &gt;&gt;${comment.replyToNumber}</a>` : ""}
      <div class="post-body">${renderCommentBody(comment.body)}</div>
      <footer class="post-actions">${(comment.reactions || []).map((reaction) => `<button type="button" data-comment-reaction="${reaction.id}" data-comment="${comment.id}">${escapeHtml(reaction.label)}${reaction.count ? ` ${reaction.count}` : ""}</button>`).join("")}${comment.sourceUrl ? `<a href="${escapeHtml(comment.sourceUrl)}" target="_blank" rel="noreferrer">出典</a>` : ""}<button type="button" data-reply="${comment.id}" data-number="${comment.number}">返信</button><button type="button" data-report-comment="${comment.id}">通報</button></footer>
    </article>`;
  }).join("");
  el.commentList.querySelectorAll("[data-reply]").forEach((button) => button.addEventListener("click", () => beginReply(button.dataset.reply, Number(button.dataset.number))));
  el.commentList.querySelectorAll("[data-comment-reaction]").forEach((button) => button.addEventListener("click", () => submitCommentReaction(button)));
  el.commentList.querySelectorAll("[data-report-comment]").forEach((button) => button.addEventListener("click", () => openReport({ targetType: "comment", threadId, targetId: button.dataset.reportComment, title: "コメント通報" })));
}

async function submitCommentReaction(button) {
  try {
    const payload = await requestJson(`/api/threads/${threadId}/comments/${button.dataset.comment}/reactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reaction: button.dataset.commentReaction }) });
    state.detail.comments = payload.comments;
    renderComments();
  } catch (error) { setFeedback(el.commentFeedback, parseCooldown(error)); }
}

function renderConversationFilter(ownStance) {
  const filters = [{ id: "mixed", label: "全レス" }, { id: "exchange", label: "返信が続いているレス" }];
  if (ownStance) filters.splice(1, 0, { id: "same", label: "自分と同じ側" }, { id: "opposite", label: "自分と反対側" }, { id: "unspoken", label: "立場なし" });
  if (!filters.some((filter) => filter.id === state.filter)) state.filter = "mixed";
  el.conversationFilter.innerHTML = filters.map((filter) => `<button type="button" data-filter="${filter.id}" class="${state.filter === filter.id ? "is-active" : ""}">${filter.label}</button>`).join("");
  el.conversationFilter.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; renderComments(); }));
}

function beginReply(id, number) {
  const comment = state.detail.comments.find((item) => item.id === id);
  if (!comment) return;
  state.replyTo = { id, number };
  el.replyContext.hidden = false;
  el.replyContext.innerHTML = `<span>&gt;&gt;${number} に返信</span><button type="button" aria-label="返信を解除">×</button>`;
  el.replyContext.querySelector("button").addEventListener("click", clearReply);
  if (!el.commentBody.value.trim()) el.commentBody.value = `>>${number} `;
  renderComments();
  el.commentBody.focus();
}

function clearReply() {
  state.replyTo = null;
  el.replyContext.hidden = true;
  el.replyContext.replaceChildren();
  renderComments();
}

function renderRelated() {
  const threads = state.detail.relatedThreads || [];
  el.relatedSection.hidden = !threads.length;
  el.relatedThreads.innerHTML = threads.map((thread) => `<a class="flat-list-row compact-row" href="/thread/${thread.id}"><strong>${escapeHtml(thread.title)}</strong><span class="mini-row">${thread.commentCount}レス · ${relativeTime(thread.lastActivityAt)}</span></a>`).join("");
}

function populateComposer() {
  el.commentStance.insertAdjacentHTML("beforeend", state.detail.positionDefinitions.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join(""));
  el.commentClaimType.insertAdjacentHTML("beforeend", state.detail.claimDefinitions.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join(""));
  el.commentStance.value = readLocal("threadStances", {})[threadId] || "";
  el.commentImpacts.innerHTML = state.detail.impactDefinitions.map((item) => `<label><input type="checkbox" value="${item.id}"/><span>${escapeHtml(item.label)}</span></label>`).join("");
}

async function submitComment(event) {
  event.preventDefault();
  setFeedback(el.commentFeedback, "");
  const impactAreas = [...el.commentImpacts.querySelectorAll("input:checked")].map((input) => input.value);
  try {
    const payload = await requestJson(`/api/threads/${threadId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: el.commentAuthor.value, body: el.commentBody.value, stance: el.commentStance.value, claimType: el.commentClaimType.value, impactAreas, sourceUrl: el.commentSource.value, replyToId: state.replyTo?.id || "" }),
    });
    state.detail.thread = payload.thread;
    state.detail.comments = payload.comments;
    const ownCommentIds = new Set(readLocal("ownCommentIds", []));
    ownCommentIds.add(payload.comments.at(-1).id);
    writeLocal("ownCommentIds", [...ownCommentIds].slice(-500));
    el.commentBody.value = "";
    el.commentSource.value = "";
    clearReply();
    renderThread();
    location.hash = `comment-${payload.comments.at(-1).number}`;
  } catch (error) {
    setFeedback(el.commentFeedback, parseCooldown(error));
  }
}

function openReport(target) { state.reportTarget = target; el.reportTitle.textContent = target.title; el.reportDialog.showModal(); }
async function submitReport(event) { event.preventDefault(); try { await requestJson("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state.reportTarget, reporter: el.reporterName.value, reason: el.reportReason.value, details: el.reportDetails.value }) }); el.reportDialog.close(); } catch (error) { setFeedback(el.reportFeedback, parseCooldown(error)); } }
function renderAll() { renderThread(); renderComments(); renderRelated(); }

async function initialize() {
  [state.board, state.detail] = await Promise.all([requestJson("/api/board"), requestJson(`/api/threads/${threadId}`)]);
  state.lastSeen = Number(readLocal("lastSeenComments", {})[threadId] || 0);
  populateComposer();
  renderAll();
  const seen = readLocal("lastSeenComments", {});
  seen[threadId] = Math.max(0, ...state.detail.comments.map((comment) => comment.number));
  writeLocal("lastSeenComments", seen);
  el.watchButton.addEventListener("click", () => { const active = toggleWatch(threadId); el.watchButton.textContent = active ? "★" : "☆"; el.watchButton.classList.toggle("is-active", active); });
  el.reportThreadButton.addEventListener("click", () => openReport({ targetType: "thread", threadId, targetId: threadId, title: "論点を通報" }));
  el.commentForm.addEventListener("submit", submitComment);
  el.reportForm.addEventListener("submit", submitReport);
  el.closeReport.addEventListener("click", () => el.reportDialog.close());
  el.commentStance.addEventListener("change", () => { const stances = readLocal("threadStances", {}); if (el.commentStance.value) stances[threadId] = el.commentStance.value; else delete stances[threadId]; writeLocal("threadStances", stances); renderComments(); });
}

initialize().catch((error) => { console.error(error); el.threadTitle.textContent = "スレッドを読み込めませんでした"; });
