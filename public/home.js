const {
  escapeHtml, requestJson, numberFormat, relativeTime, roomLabel, renderRoomTabs,
  renderThreadRows, renderTarget, isWatched, toggleWatch,
} = window.BoardShared;

const impactLabels = { all: "すべて", household: "家計", work: "仕事", region: "地域", future: "将来", rights: "権利・制度", security: "安全" };
const sourceKindLabels = { official: "公的資料", news: "報道", analysis: "分析", other: "出典あり" };
const state = { payload: null, impact: "all" };
const elements = Object.fromEntries([
  "roomTabs", "impactFilter", "issueHeading", "dailyIssueGrid", "watchSection", "watchCount",
  "watchedThreads", "groundedThreads", "featuredPoliticians", "roomDirectory", "homeCounts",
].map((id) => [id, document.getElementById(id)]));

function stanceLabel(thread) {
  const positions = thread.positions || [];
  const total = positions.reduce((sum, item) => sum + item.count, 0);
  if (!total) return "まだ判断が集まっていません";
  const sorted = [...positions].sort((a, b) => b.count - a.count);
  if (sorted[0].count - sorted[1].count <= Math.max(1, total * 0.15)) return "意見が割れています";
  if (sorted[0].id === "unsure") return "判断保留が多い論点";
  return `${sorted[0].label}の声が多い論点`;
}

function renderImpactFilter() {
  elements.impactFilter.innerHTML = Object.entries(impactLabels).map(([id, label]) =>
    `<button type="button" data-impact="${id}" class="segment${state.impact === id ? " is-active" : ""}">${label}</button>`
  ).join("");
  elements.impactFilter.querySelectorAll("[data-impact]").forEach((button) => button.addEventListener("click", () => {
    state.impact = button.dataset.impact;
    renderImpactFilter();
    renderIssues();
  }));
}

function matchingIssues() {
  const threads = state.payload.featured.dailyIssues || [];
  if (state.impact === "all") return threads;
  return threads.filter((thread) => (thread.impactAreas || []).includes(state.impact));
}

function renderIssues() {
  const threads = matchingIssues();
  elements.issueHeading.textContent = state.impact === "all" ? "あなたに関係する論点" : `${impactLabels[state.impact]}に関係する論点`;
  if (!threads.length) {
    elements.dailyIssueGrid.innerHTML = `<p class="empty-state">この領域の論点はまだありません。</p>`;
    return;
  }
  elements.dailyIssueGrid.innerHTML = threads.map((thread) => `
    <article class="issue-card">
      <div class="issue-card-head"><span class="badge">${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span><span class="mini-row">${escapeHtml(sourceKindLabels[thread.sourceKind] || "出典あり")}</span></div>
      <div class="impact-tags">${(thread.impactAreas || []).map((id) => `<span>${escapeHtml(impactLabels[id] || id)}</span>`).join("")}</div>
      <h3><a href="/thread/${thread.id}">${escapeHtml(thread.title)}</a></h3>
      <p>${escapeHtml(thread.decisionPrompt || thread.summary)}</p>
      <div class="discussion-health"><strong>${escapeHtml(stanceLabel(thread))}</strong><span>根拠つき ${numberFormat.format(thread.evidenceRate || 0)}%</span></div>
      <div class="inline-row">${renderTarget(thread.target)}</div>
      <div class="issue-actions"><a class="button button-primary" href="/thread/${thread.id}">自分の立場を決める</a><button class="watch-button${isWatched(thread.id) ? " is-active" : ""}" type="button" data-watch="${thread.id}" title="あとで追う" aria-label="あとで追う">${isWatched(thread.id) ? "★" : "☆"}</button></div>
    </article>`).join("");
  bindWatchButtons(elements.dailyIssueGrid);
}

function bindWatchButtons(container) {
  container.querySelectorAll("[data-watch]").forEach((button) => button.addEventListener("click", () => {
    const active = toggleWatch(button.dataset.watch);
    button.textContent = active ? "★" : "☆";
    button.classList.toggle("is-active", active);
    renderWatched();
  }));
}

function renderWatched() {
  const threads = state.payload.featured.dailyIssues.filter((thread) => isWatched(thread.id));
  elements.watchSection.hidden = threads.length === 0;
  elements.watchCount.textContent = `${threads.length}件`;
  elements.watchedThreads.innerHTML = threads.map((thread) => `<a href="/thread/${thread.id}"><strong>${escapeHtml(thread.title)}</strong><span>${escapeHtml(stanceLabel(thread))}</span></a>`).join("");
}

function renderRooms(rooms) {
  elements.roomDirectory.innerHTML = `<div class="room-card-grid">${rooms.map((room) => `
    <a class="room-card" href="/room/${room.id}"><strong>${escapeHtml(room.label)}</strong><span>${escapeHtml(room.note)}</span><small>${numberFormat.format(room.threadCount || 0)}論点 · ${numberFormat.format(room.commentCount || 0)}投稿</small></a>`).join("")}</div>`;
}

function renderPoliticians(politicians) {
  elements.featuredPoliticians.innerHTML = politicians.map((politician) => `
    <a class="politician-list-row" href="/politician/${politician.id}"><span class="politician-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span><span class="politician-list-copy"><strong>${escapeHtml(politician.name)}</strong><span>${escapeHtml(politician.groupShort)} · ${escapeHtml(politician.district)}</span></span><span class="politician-activity">${numberFormat.format(politician.threadCount)}<small>論点</small></span></a>`).join("");
}

async function initialize() {
  state.payload = await requestJson("/api/home");
  renderRoomTabs(elements.roomTabs, state.payload.rooms, null);
  renderImpactFilter();
  renderIssues();
  renderWatched();
  renderRooms(state.payload.rooms);
  renderPoliticians(state.payload.featured.politicians || []);
  elements.groundedThreads.innerHTML = renderThreadRows(state.payload.featured.groundedThreads || [], state.payload.rooms, { showRoom: true });
  elements.homeCounts.textContent = `${numberFormat.format(state.payload.meta.totalThreads)}論点 · ${numberFormat.format(state.payload.meta.totalComments)}投稿`;
}

initialize().catch((error) => { console.error(error); elements.dailyIssueGrid.innerHTML = `<p class="empty-state">読込に失敗しました。</p>`; });
