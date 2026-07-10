const {
  escapeHtml,
  requestJson,
  relativeTime,
  numberFormat,
  formatTimestamp,
  renderRoomTabs,
  roomLabel,
} = window.BoardShared;

const state = {
  board: null,
  queue: [],
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  moderationSummary: document.getElementById("moderationSummary"),
  queueCount: document.getElementById("queueCount"),
  moderationQueue: document.getElementById("moderationQueue"),
};

function renderSummary() {
  const moderation = state.board?.moderation || {};
  const meta = state.board?.meta || {};

  elements.moderationSummary.innerHTML = `
    <span>通報 <strong>${numberFormat.format(moderation.pendingReports || 0)}</strong></span>
    <span>ロック <strong>${numberFormat.format(moderation.lockedThreads || 0)}</strong></span>
    <span>slow <strong>${numberFormat.format(moderation.slowedThreads || 0)}</strong></span>
    <span>保存 <strong>${escapeHtml(formatTimestamp(meta.lastSavedAt))}</strong></span>
  `;
}

function renderQueue() {
  elements.queueCount.textContent = numberFormat.format(state.queue.length);

  if (!state.queue.length) {
    elements.moderationQueue.innerHTML = `<p class="empty-state">通報はありません。</p>`;
    return;
  }

  elements.moderationQueue.innerHTML = state.queue
    .map(
      (report) => `
        <article class="flat-list-row moderation-row">
          <div class="row-main">
            <strong>${escapeHtml(report.reason)}</strong>
            <div class="mini-row">
              <span>${escapeHtml(roomLabel(state.board.rooms, report.room))}</span>
              <span>${escapeHtml(report.threadTitle)}</span>
              <span>${escapeHtml(relativeTime(report.createdAt))}</span>
              <span>${escapeHtml(report.targetType)}</span>
            </div>
          </div>
          <div class="button-row">
            <a class="button button-muted" href="/thread/${report.threadId}">開く</a>
            <button class="button button-primary" type="button" data-report-id="${report.id}" data-status="resolved">解決</button>
            <button class="button button-muted" type="button" data-report-id="${report.id}" data-status="dismissed">却下</button>
          </div>
          <div class="row-body">${escapeHtml(report.snippet || report.details || "-")}</div>
        </article>
      `
    )
    .join("");

  for (const button of elements.moderationQueue.querySelectorAll("[data-report-id]")) {
    button.addEventListener("click", async () => {
      await requestJson(`/api/moderation/reports/${button.dataset.reportId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: button.dataset.status,
          note: button.dataset.status === "resolved" ? "処理" : "却下",
        }),
      });

      await loadPage();
    });
  }
}

async function loadPage() {
  const [board, queuePayload] = await Promise.all([
    requestJson("/api/board"),
    requestJson("/api/moderation/queue"),
  ]);

  state.board = board;
  state.queue = queuePayload.reports || [];
  renderRoomTabs(elements.roomTabs, state.board.rooms, null);
  renderSummary();
  renderQueue();
}

loadPage().catch((error) => {
  console.error(error);
  elements.moderationQueue.innerHTML = `<p class="empty-state">読込失敗: ${escapeHtml(error.message)}</p>`;
});
