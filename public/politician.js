const {
  escapeHtml,
  requestJson,
  numberFormat,
  formatDate,
  relativeTime,
  renderRoomTabs,
  roomLabel,
} = window.BoardShared;

const politicianId = decodeURIComponent(window.location.pathname.split("/").pop() || "");

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  politicianProfile: document.getElementById("politicianProfile"),
  politicianBoardTitle: document.getElementById("politicianBoardTitle"),
  politicianBoardMeta: document.getElementById("politicianBoardMeta"),
  politicianNewThread: document.getElementById("politicianNewThread"),
  politicianThreadCount: document.getElementById("politicianThreadCount"),
  politicianThreads: document.getElementById("politicianThreads"),
  politicianEmotions: document.getElementById("politicianEmotions"),
};

function reactionTotals(threads, definitions) {
  const totals = new Map(definitions.map((definition) => [definition.id, { ...definition, count: 0 }]));
  for (const thread of threads) {
    for (const reaction of thread.reactions || []) {
      const total = totals.get(reaction.id);
      if (total) total.count += reaction.count;
    }
  }
  return [...totals.values()].sort((left, right) => right.count - left.count);
}

function renderProfile(politician) {
  document.title = `${politician.name} | 政経フォーラム`;
  elements.politicianBoardTitle.textContent = `${politician.name}について語る`;
  elements.politicianBoardMeta.textContent = `${politician.groupShort} · ${politician.district}`;
  elements.politicianNewThread.href = `/new?targetType=politician&targetId=${encodeURIComponent(politician.id)}`;
  elements.politicianProfile.innerHTML = `
    <span class="politician-avatar profile-avatar" aria-hidden="true">${escapeHtml(
      politician.name.replace(/\s/g, "").slice(0, 1)
    )}</span>
    <div class="profile-copy">
      <div class="inline-row">
        <span class="badge">${escapeHtml(politician.chamber)}</span>
        <span class="badge">${escapeHtml(politician.groupShort)}</span>
      </div>
      <h1>${escapeHtml(politician.name)}</h1>
      <p>${escapeHtml(politician.nameKana)}</p>
      <div class="profile-facts">
        <span><small>会派</small>${escapeHtml(politician.group)}</span>
        <span><small>選挙区</small>${escapeHtml(politician.district)}</span>
        <span><small>公式情報時点</small>${escapeHtml(formatDate(politician.sourceAsOf))}</span>
        <span><small>確認日</small>${escapeHtml(formatDate(politician.verifiedAt))}</span>
      </div>
    </div>
    <div class="profile-actions">
      <a class="button button-muted" href="${escapeHtml(
        politician.sourceUrl
      )}" target="_blank" rel="noreferrer">公式情報</a>
    </div>
  `;
}

function renderThreads(threads, rooms) {
  if (!threads.length) return '<p class="empty-state">まだスレがありません。最初の話題を立てられます。</p>';
  return threads.map((thread) => `<a class="conversation-row" href="/thread/${thread.id}"><div class="conversation-row-main"><div class="inline-row"><span class="badge">${escapeHtml(roomLabel(rooms, thread.room))}</span>${thread.mode === "opposition-welcome" ? '<span class="badge badge-danger">反対歓迎</span>' : ""}</div><strong>${escapeHtml(thread.title)}</strong><p>${escapeHtml(thread.latestExcerpt || thread.summary)}</p></div><div class="conversation-row-stats"><span><strong>${numberFormat.format(thread.heat || 0)}</strong>勢い</span><span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span><span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span><small>${relativeTime(thread.lastActivityAt)}</small></div></a>`).join("");
}

function renderEmotions(threads, definitions) {
  const totals = reactionTotals(threads, definitions);
  const max = Math.max(...totals.map((item) => item.count), 1);
  elements.politicianEmotions.innerHTML = totals
    .map(
      (reaction) => `
        <div class="emotion-overview-row" data-tone="${escapeHtml(reaction.tone)}">
          <div><span>${escapeHtml(reaction.label)}</span><strong>${numberFormat.format(reaction.count)}</strong></div>
          <span class="emotion-meter"><span style="width: ${(reaction.count / max) * 100}%"></span></span>
        </div>
      `
    )
    .join("");
}

async function initialize() {
  const payload = await requestJson(`/api/politicians/${politicianId}`);
  renderRoomTabs(elements.roomTabs, payload.rooms, null);
  renderProfile(payload.politician);
  elements.politicianThreadCount.textContent = `${numberFormat.format(payload.threads.length)}件`;
  elements.politicianThreads.innerHTML = renderThreads(payload.threads, payload.rooms);
}

initialize().catch((error) => {
  console.error(error);
  elements.politicianProfile.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
