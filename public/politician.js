const {
  escapeHtml,
  requestJson,
  numberFormat,
  formatDate,
  renderRoomTabs,
  renderThreadRows,
} = window.BoardShared;

const politicianId = decodeURIComponent(window.location.pathname.split("/").pop() || "");

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  politicianProfile: document.getElementById("politicianProfile"),
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
      <a class="button button-primary" href="/new?targetType=politician&targetId=${encodeURIComponent(
        politician.id
      )}">この議員でスレを立てる</a>
      <a class="button button-muted" href="${escapeHtml(
        politician.sourceUrl
      )}" target="_blank" rel="noreferrer">公式情報</a>
    </div>
  `;
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
  elements.politicianThreads.innerHTML = renderThreadRows(payload.threads, payload.rooms, {
    showRoom: true,
    emptyMessage: "この議員を対象にしたスレはまだありません。",
  });
  renderEmotions(payload.threads, payload.reactionDefinitions);
}

initialize().catch((error) => {
  console.error(error);
  elements.politicianProfile.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
