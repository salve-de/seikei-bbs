const {
  escapeHtml,
  requestJson,
  numberFormat,
  relativeTime,
  renderRoomTabs,
  renderThreadRows,
} = window.BoardShared;

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  homeThreadCount: document.getElementById("homeThreadCount"),
  homeCommentCount: document.getElementById("homeCommentCount"),
  roomDirectory: document.getElementById("roomDirectory"),
  featuredHotThreads: document.getElementById("featuredHotThreads"),
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
        <span>先頭</span>
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
              <div class="room-main">
                <strong>${escapeHtml(room.hotThread?.title || "-")}</strong>
              </div>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderHome(payload) {
  renderRoomTabs(elements.roomTabs, payload.rooms, null);
  elements.homeThreadCount.textContent = numberFormat.format(payload.meta.totalThreads || 0);
  elements.homeCommentCount.textContent = numberFormat.format(payload.meta.totalComments || 0);
  renderRooms(payload.rooms);
  elements.featuredHotThreads.innerHTML = renderThreadRows(payload.featured.hotThreads || [], payload.rooms, {
    showRoom: true,
    emptyMessage: "スレがありません。",
  });
}

async function initialize() {
  const payload = await requestJson("/api/home");
  renderHome(payload);
}

initialize().catch((error) => {
  console.error(error);
  elements.roomDirectory.innerHTML = `<p class="empty-state">読込失敗: ${escapeHtml(error.message)}</p>`;
});
