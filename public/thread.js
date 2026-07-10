const { escapeHtml, requestJson, relativeTime, numberFormat, renderRoomTabs, renderTags, renderTarget, setFeedback, parseCooldown, isWatched, toggleWatch, rememberAction, rememberedAction } = window.BoardShared;
const threadId = decodeURIComponent(location.pathname.split("/").pop() || "");
const state = { board: null, detail: null, reportTarget: null, sort: "useful" };
const impactLabels = { household: "家計", work: "仕事", region: "地域", future: "将来", rights: "権利・制度", security: "安全" };
const sourceKindLabels = { official: "公的機関", news: "報道", analysis: "解説・分析", other: "その他" };
const el = Object.fromEntries(["roomTabs","threadBreadcrumb","threadBadges","threadTitle","threadSummary","threadMeta","watchButton","reportThreadButton","threadSource","decisionPrompt","positionBar","positionResult","positionFeedback","discussionSummary","commentList","commentForm","commentStance","commentClaimType","commentImpacts","commentAuthor","commentBody","commentSourceField","commentSource","commentSubmit","commentFeedback","relatedSection","relatedThreads","reportDialog","reportForm","reportTitle","reporterName","reportReason","reportDetails","reportFeedback","closeReport"].map((id) => [id, document.getElementById(id)]));

function label(definitions, id) { return definitions.find((item) => item.id === id)?.label || id; }
function countSignal(comment, id) { return comment.helpfulness?.find((item) => item.id === id)?.count || 0; }
function shortDate(value) { return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value)); }

function renderThread() {
  const { thread, room } = state.detail;
  renderRoomTabs(el.roomTabs, state.board.rooms, room.id);
  el.threadBreadcrumb.innerHTML = `<a href="/">今日の争点</a><span>/</span><a href="/room/${room.id}">${escapeHtml(room.label)}</a>`;
  el.threadTitle.textContent = thread.title;
  el.threadSummary.textContent = thread.summary;
  el.threadBadges.innerHTML = `${renderTarget(thread.target)} ${renderTags(thread.tags)} ${(thread.impactAreas || []).map((id) => `<span class="impact-chip">${escapeHtml(impactLabels[id] || id)}</span>`).join("")}`;
  el.threadMeta.innerHTML = `<span>${escapeHtml(thread.author)}</span><span>${numberFormat.format(thread.commentCount)}投稿</span><span>${escapeHtml(sourceKindLabels[thread.sourceKind] || "出典あり")}</span>`;
  el.decisionPrompt.textContent = thread.decisionPrompt;
  el.watchButton.textContent = isWatched(thread.id) ? "★" : "☆";
  el.watchButton.classList.toggle("is-active", isWatched(thread.id));
  let hostname = "出典"; try { hostname = new URL(thread.sourceUrl).hostname.replace(/^www\./, ""); } catch {}
  el.threadSource.innerHTML = `<div><span class="source-label">${escapeHtml(sourceKindLabels[thread.sourceKind] || "出典")}</span><strong>${escapeHtml(hostname)}</strong><p>${escapeHtml(thread.body)}</p></div><a class="button button-primary" href="${escapeHtml(thread.sourceUrl)}" target="_blank" rel="noreferrer">出典を読む</a>`;
}

function renderPositions() {
  const { thread, positionDefinitions } = state.detail;
  const selected = rememberedAction("positions", thread.id);
  el.positionBar.innerHTML = positionDefinitions.map((item) => `<button class="position-button${selected === item.id ? " is-selected" : ""}" type="button" data-position="${item.id}">${escapeHtml(item.label)}</button>`).join("");
  el.positionBar.querySelectorAll("[data-position]").forEach((button) => button.addEventListener("click", () => submitPosition(button.dataset.position)));
  el.positionResult.hidden = !selected;
  if (selected) {
    const total = Math.max(1, thread.positionTotal);
    el.positionResult.innerHTML = thread.positions.map((item) => `<div><span>${escapeHtml(item.label)}</span><div class="result-track"><i style="width:${Math.round(item.count / total * 100)}%"></i></div><strong>${Math.round(item.count / total * 100)}%</strong></div>`).join("");
  }
}

async function submitPosition(position) {
  if (rememberedAction("positions", threadId)) return;
  try {
    const payload = await requestJson(`/api/threads/${threadId}/positions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position }) });
    rememberAction("positions", threadId, position); state.detail.thread = payload.thread; renderPositions();
  } catch (error) { setFeedback(el.positionFeedback, parseCooldown(error)); }
}

function sortedComments() {
  const comments = [...state.detail.comments];
  if (state.sort === "new") return comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (state.sort === "changed") return comments.sort((a, b) => countSignal(b, "changed") - countSignal(a, "changed"));
  return comments.sort((a, b) => countSignal(b, "useful") + countSignal(b, "changed") * 2 - countSignal(a, "useful") - countSignal(a, "changed") * 2);
}

function renderComments() {
  const comments = sortedComments();
  const support = comments.filter((item) => item.stance === "support").length;
  const oppose = comments.filter((item) => item.stance === "oppose").length;
  const unsure = comments.filter((item) => item.stance === "unsure").length;
  el.discussionSummary.innerHTML = `<div><strong>${support}</strong><span>賛成寄り</span></div><div><strong>${oppose}</strong><span>反対寄り</span></div><div><strong>${unsure}</strong><span>判断保留</span></div><div><strong>${state.detail.thread.evidenceRate}%</strong><span>出典つき</span></div>`;
  if (!comments.length) { el.commentList.innerHTML = `<p class="empty-state">最初の見方を残してください。</p>`; return; }
  el.commentList.innerHTML = comments.map((comment) => `
    <article class="comment-card" data-stance="${comment.stance}">
      <div class="comment-head"><div><span class="stance-label">${escapeHtml(label(state.detail.positionDefinitions, comment.stance))}</span><span class="claim-label">${escapeHtml(label(state.detail.claimDefinitions, comment.claimType))}</span></div><span>${escapeHtml(shortDate(comment.createdAt))}</span></div>
      <strong class="comment-author">${escapeHtml(comment.author)}</strong><p>${escapeHtml(comment.body)}</p>
      <div class="impact-tags">${comment.impactAreas.map((id) => `<span>${escapeHtml(impactLabels[id] || id)}</span>`).join("")}</div>
      ${comment.sourceUrl ? `<a class="source-link" href="${escapeHtml(comment.sourceUrl)}" target="_blank" rel="noreferrer">根拠を開く</a>` : ""}
      <div class="comment-actions">${comment.helpfulness.map((signal) => `<button type="button" data-helpful="${signal.id}" data-comment="${comment.id}">${escapeHtml(signal.label)} <strong>${signal.count}</strong></button>`).join("")}<button type="button" data-report-comment="${comment.id}">通報</button></div>
    </article>`).join("");
  el.commentList.querySelectorAll("[data-helpful]").forEach((button) => button.addEventListener("click", () => submitHelpful(button)));
  el.commentList.querySelectorAll("[data-report-comment]").forEach((button) => button.addEventListener("click", () => openReport({ targetType: "comment", threadId, targetId: button.dataset.reportComment, title: "コメント通報" })));
}

async function submitHelpful(button) {
  const key = `${button.dataset.comment}:${button.dataset.helpful}`;
  if (rememberedAction("helpfulness", key)) return;
  try {
    const payload = await requestJson(`/api/threads/${threadId}/comments/${button.dataset.comment}/helpfulness`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signal: button.dataset.helpful }) });
    rememberAction("helpfulness", key, true); state.detail.comments = payload.comments; renderComments();
  } catch (error) { setFeedback(el.commentFeedback, parseCooldown(error)); }
}

function renderRelated() {
  const threads = state.detail.relatedThreads || []; el.relatedSection.hidden = !threads.length;
  el.relatedThreads.innerHTML = threads.map((thread) => `<a class="flat-list-row compact-row" href="/thread/${thread.id}"><strong>${escapeHtml(thread.title)}</strong><span class="mini-row">整理度 ${thread.value} · ${thread.commentCount}投稿</span></a>`).join("");
}

function populateComposer() {
  el.commentStance.innerHTML = state.detail.positionDefinitions.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("");
  el.commentClaimType.innerHTML = state.detail.claimDefinitions.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("");
  el.commentImpacts.innerHTML = state.detail.impactDefinitions.map((item) => `<label><input type="checkbox" value="${item.id}" ${(state.detail.thread.impactAreas || []).includes(item.id) ? "checked" : ""}/><span>${escapeHtml(item.label)}</span></label>`).join("");
}

async function submitComment(event) {
  event.preventDefault(); setFeedback(el.commentFeedback, "");
  const impactAreas = [...el.commentImpacts.querySelectorAll("input:checked")].map((input) => input.value);
  try {
    await requestJson(`/api/threads/${threadId}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: el.commentAuthor.value, body: el.commentBody.value, stance: el.commentStance.value, claimType: el.commentClaimType.value, impactAreas, sourceUrl: el.commentSource.value }) });
    el.commentBody.value = ""; el.commentSource.value = ""; await refresh();
  } catch (error) { setFeedback(el.commentFeedback, parseCooldown(error)); }
}

function openReport(target) { state.reportTarget = target; el.reportTitle.textContent = target.title; el.reportDialog.showModal(); }
async function submitReport(event) { event.preventDefault(); try { await requestJson("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state.reportTarget, reporter: el.reporterName.value, reason: el.reportReason.value, details: el.reportDetails.value }) }); el.reportDialog.close(); } catch (error) { setFeedback(el.reportFeedback, parseCooldown(error)); } }

function renderAll() { renderThread(); renderPositions(); renderComments(); renderRelated(); }
async function refresh() { state.detail = await requestJson(`/api/threads/${threadId}`); renderAll(); }
async function initialize() { [state.board, state.detail] = await Promise.all([requestJson("/api/board"), requestJson(`/api/threads/${threadId}`)]); populateComposer(); renderAll();
  el.watchButton.addEventListener("click", () => { const active = toggleWatch(threadId); el.watchButton.textContent = active ? "★" : "☆"; el.watchButton.classList.toggle("is-active", active); });
  el.reportThreadButton.addEventListener("click", () => openReport({ targetType: "thread", threadId, targetId: threadId, title: "論点を通報" }));
  el.commentForm.addEventListener("submit", submitComment); el.reportForm.addEventListener("submit", submitReport); el.closeReport.addEventListener("click", () => el.reportDialog.close());
  el.commentClaimType.addEventListener("change", () => { el.commentSourceField.hidden = el.commentClaimType.value !== "fact"; el.commentSource.required = el.commentClaimType.value === "fact"; });
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => { state.sort = button.dataset.sort; document.querySelectorAll("[data-sort]").forEach((item) => item.classList.toggle("is-active", item === button)); renderComments(); }));
}
initialize().catch((error) => { console.error(error); el.threadTitle.textContent = "論点を読み込めませんでした"; });
