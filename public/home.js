const {
  escapeHtml,
  requestJson,
  numberFormat,
  relativeTime,
  roomLabel,
  renderRoomTabs,
  renderThreadRows,
  renderTarget,
} = window.BoardShared;

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  homeThreadCount: document.getElementById("homeThreadCount"),
  homeCommentCount: document.getElementById("homeCommentCount"),
  dailyIssueGrid: document.getElementById("dailyIssueGrid"),
  roomDirectory: document.getElementById("roomDirectory"),
  featuredHotThreads: document.getElementById("featuredHotThreads"),
  featuredPoliticians: document.getElementById("featuredPoliticians"),
};

function renderRooms(rooms) {
  if (!rooms.length) {
    elements.roomDirectory.innerHTML = `<p class="empty-state">部屋がありません。</p>`;
    return;
  }

  elements.roomDirectory.innerHTML = `
    <div class="flat-table">
      <div class="flat-table-head room-head">
        <span>部屋</span>
        <span>スレ</span>
        <span>レス</span>
        <span>更新</span>
        <span>いまの先頭</span>
      </div>
      ${rooms
        .map(
          (room) => `
            <a class="flat-table-row room-row" href="/room/${room.id}">
              <div class="room-main">
                <strong>${escapeHtml(room.label)}</strong>
                <div class="mini-row">${escapeHtml(room.note)}</div>
              </div>
              <div class="numeric-cell">${numberFormat.format(room.threadCount || 0)}</div>
              <div class="numeric-cell">${numberFormat.format(room.commentCount || 0)}</div>
              <div class="numeric-cell">${escapeHtml(relativeTime(room.latestActivityAt))}</div>
              <div class="room-main"><strong>${escapeHtml(room.hotThread?.title || "-")}</strong></div>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function strongestReactions(thread) {
  return [...(thread.reactions || [])]
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
}

function renderDailyIssues(threads, rooms) {
  if (!threads.length) {
    elements.dailyIssueGrid.innerHTML = `<p class="empty-state">争点はありません。</p>`;
    return;
  }

  elements.dailyIssueGrid.innerHTML = threads
    .map(
      (thread, index) => `
        <article class="issue-card" data-rank="${index + 1}">
          <div class="issue-card-head">
            <span class="issue-rank">0${index + 1}</span>
            <span class="badge">${escapeHtml(roomLabel(rooms, thread.room))}</span>
            <span class="mini-row">${escapeHtml(relativeTime(thread.lastActivityAt))}</span>
          </div>
          <h3><a href="/thread/${thread.id}">${escapeHtml(thread.title)}</a></h3>
          <p>${escapeHtml(thread.summary)}</p>
          <div class="inline-row">${renderTarget(thread.target)}</div>
          <div class="emotion-strip">
            ${strongestReactions(thread)
              .map(
                (reaction) => `
                  <span class="emotion-count" data-tone="${escapeHtml(reaction.tone)}">
                    ${escapeHtml(reaction.label)} <strong>${numberFormat.format(reaction.count)}</strong>
                  </span>
                `
              )
              .join("")}
          </div>
          <a class="issue-card-link" href="/thread/${thread.id}">議論を読む</a>
        </article>
      `
    )
    .join("");
}

function renderPoliticians(politicians) {
  elements.featuredPoliticians.innerHTML = politicians
    .map(
      (politician) => `
        <a class="politician-list-row" href="/politician/${politician.id}">
          <span class="politician-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span>
          <span class="politician-list-copy">
            <strong>${escapeHtml(politician.name)}</strong>
            <span>${escapeHtml(politician.groupShort)} · ${escapeHtml(politician.district)}</span>
          </span>
          <span class="politician-activity">${numberFormat.format(politician.activityCount)}<small>活動</small></span>
        </a>
      `
    )
    .join("");
}

function renderHome(payload) {
  renderRoomTabs(elements.roomTabs, payload.rooms, null);
  elements.homeThreadCount.textContent = numberFormat.format(payload.meta.totalThreads || 0);
  elements.homeCommentCount.textContent = numberFormat.format(payload.meta.totalComments || 0);
  renderDailyIssues(payload.featured.dailyIssues || [], payload.rooms);
  renderRooms(payload.rooms);
  renderPoliticians(payload.featured.politicians || []);
  elements.featuredHotThreads.innerHTML = renderThreadRows(
    payload.featured.hotThreads || [],
    payload.rooms,
    { showRoom: true, emptyMessage: "スレがありません。" }
  );
}

async function initialize() {
  renderHome(await requestJson("/api/home"));
}

initialize().catch((error) => {
  console.error(error);
  elements.dailyIssueGrid.innerHTML = `<p class="empty-state">読込失敗: ${escapeHtml(error.message)}</p>`;
});
