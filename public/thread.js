const {
  escapeHtml,
  requestJson,
  relativeTime,
  numberFormat,
  renderRoomTabs,
  renderBadges,
  renderTags,
  setFeedback,
  parseCooldown,
} = window.BoardShared;

const threadId = decodeURIComponent(window.location.pathname.split("/").pop() || "");

const state = {
  board: null,
  detail: null,
  reportTarget: null,
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  threadBreadcrumb: document.getElementById("threadBreadcrumb"),
  threadTitle: document.getElementById("threadTitle"),
  roomBackLink: document.getElementById("roomBackLink"),
  reportThreadButton: document.getElementById("reportThreadButton"),
  threadMeta: document.getElementById("threadMeta"),
  threadBadges: document.getElementById("threadBadges"),
  threadBodyContent: document.getElementById("threadBodyContent"),
  commentMeta: document.getElementById("commentMeta"),
  commentForm: document.getElementById("commentForm"),
  commentAuthor: document.getElementById("commentAuthor"),
  commentBody: document.getElementById("commentBody"),
  commentSubmit: document.getElementById("commentSubmit"),
  commentFeedback: document.getElementById("commentFeedback"),
  commentList: document.getElementById("commentList"),
  relatedSection: document.getElementById("relatedSection"),
  relatedThreads: document.getElementById("relatedThreads"),
  reportDialog: document.getElementById("reportDialog"),
  reportForm: document.getElementById("reportForm"),
  reportTitle: document.getElementById("reportTitle"),
  reporterName: document.getElementById("reporterName"),
  reportReason: document.getElementById("reportReason"),
  reportDetails: document.getElementById("reportDetails"),
  reportFeedback: document.getElementById("reportFeedback"),
  closeReport: document.getElementById("closeReport"),
};

function renderNotFound(message = "スレッドが見つかりません。") {
  elements.threadTitle.textContent = "スレッドが見つかりません";
  elements.threadBreadcrumb.innerHTML = "";
  elements.threadMeta.innerHTML = "";
  elements.threadBadges.innerHTML = "";
  elements.threadBodyContent.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  elements.commentList.innerHTML = "";
  elements.relatedSection.hidden = true;
  elements.commentBody.disabled = true;
  elements.commentSubmit.disabled = true;
}

function renderThread() {
  const detail = state.detail;
  const thread = detail?.thread;

  if (!thread) {
    renderNotFound();
    return;
  }

  const room = detail.room;

  renderRoomTabs(elements.roomTabs, state.board.rooms, room.id);
  elements.threadBreadcrumb.innerHTML = `
    <a href="/">ホーム</a>
    <span>/</span>
    <a href="/room/${room.id}">${escapeHtml(room.label)}</a>
  `;
  elements.threadTitle.textContent = thread.title;
  elements.roomBackLink.href = `/room/${room.id}`;
  elements.threadMeta.innerHTML = `
    <span>投稿者 <strong>${escapeHtml(thread.author)}</strong></span>
    <span>レス <strong>${numberFormat.format(thread.commentCount)}</strong></span>
    <span>更新 <strong>${escapeHtml(relativeTime(thread.lastActivityAt || thread.createdAt))}</strong></span>
    ${thread.sourceUrl ? `<a class="button button-muted button-link" href="${escapeHtml(thread.sourceUrl)}" target="_blank" rel="noreferrer">URL</a>` : ""}
  `;
  elements.threadBadges.innerHTML = `${renderBadges(thread)} ${renderTags(thread.tags)}`;
  elements.threadBodyContent.innerHTML = thread.body
    .split("\n")
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  elements.commentBody.disabled = Boolean(thread.locked);
  elements.commentSubmit.disabled = Boolean(thread.locked);
}

function renderComments() {
  const thread = state.detail?.thread;
  const comments = state.detail?.comments || [];

  elements.commentMeta.textContent = numberFormat.format(comments.length);

  if (!thread) {
    elements.commentList.innerHTML = "";
    return;
  }

  if (!comments.length) {
    elements.commentList.innerHTML = `<p class="empty-state">コメントはありません。</p>`;
    return;
  }

  elements.commentList.innerHTML = comments
    .map(
      (comment) => `
        <article class="flat-list-row comment-row">
          <div class="row-main">
            <strong>${escapeHtml(comment.author)}</strong>
            <div class="mini-row">
              <span>${escapeHtml(relativeTime(comment.createdAt))}</span>
              ${comment.pendingReportsCount ? `<span class="badge badge-danger">通報 ${comment.pendingReportsCount}</span>` : ""}
            </div>
          </div>
          <div class="button-row">
            <button class="button button-text" type="button" data-report-comment="${comment.id}">通報</button>
          </div>
          <div class="row-body">${escapeHtml(comment.body)}</div>
        </article>
      `
    )
    .join("");

  for (const button of elements.commentList.querySelectorAll("[data-report-comment]")) {
    button.addEventListener("click", () => {
      openReportDialog({
        targetType: "comment",
        threadId,
        targetId: button.dataset.reportComment,
        title: "コメント通報",
      });
    });
  }
}

function renderRelatedThreads() {
  const relatedThreads = state.detail?.relatedThreads || [];

  elements.relatedSection.hidden = relatedThreads.length === 0;
  if (!relatedThreads.length) {
    elements.relatedThreads.innerHTML = "";
    return;
  }

  elements.relatedThreads.innerHTML = relatedThreads
    .map(
      (thread) => `
        <a class="flat-list-row compact-row" href="/thread/${thread.id}">
          <div class="row-main">
            <strong>${escapeHtml(thread.title)}</strong>
            <div class="mini-row">
              <span>勢い ${numberFormat.format(thread.heat)}</span>
              <span>レス ${numberFormat.format(thread.commentCount)}</span>
            </div>
          </div>
        </a>
      `
    )
    .join("");
}

async function loadPage() {
  const [board, detail] = await Promise.all([
    requestJson("/api/board"),
    requestJson(`/api/threads/${threadId}`),
  ]);

  state.board = board;
  state.detail = detail;
  renderThread();
  renderComments();
  renderRelatedThreads();
}

async function refreshThread() {
  state.detail = await requestJson(`/api/threads/${threadId}`);
  renderThread();
  renderComments();
  renderRelatedThreads();
}

function openReportDialog(target) {
  state.reportTarget = target;
  elements.reportTitle.textContent = target.title;
  setFeedback(elements.reportFeedback, "");
  elements.reportDialog.showModal();
}

function closeDialog(dialog) {
  dialog.close();
}

async function submitComment(event) {
  event.preventDefault();
  setFeedback(elements.commentFeedback, "");

  try {
    await requestJson(`/api/threads/${threadId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        author: elements.commentAuthor.value,
        body: elements.commentBody.value,
      }),
    });

    elements.commentBody.value = "";
    await refreshThread();
  } catch (error) {
    setFeedback(elements.commentFeedback, parseCooldown(error));
  }
}

async function submitReport(event) {
  event.preventDefault();

  if (!state.reportTarget) {
    return;
  }

  setFeedback(elements.reportFeedback, "");

  try {
    await requestJson("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...state.reportTarget,
        reporter: elements.reporterName.value,
        reason: elements.reportReason.value,
        details: elements.reportDetails.value,
      }),
    });

    elements.reportForm.reset();
    closeDialog(elements.reportDialog);
    await refreshThread();
  } catch (error) {
    setFeedback(elements.reportFeedback, parseCooldown(error));
  }
}

async function runModerationAction(button) {
  await requestJson(`/api/moderation/threads/${threadId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: button.dataset.modAction,
      seconds: Number(button.dataset.seconds || 0),
    }),
  });

  await refreshThread();
}

function bindEvents() {
  elements.commentForm.addEventListener("submit", submitComment);
  elements.reportForm.addEventListener("submit", submitReport);
  elements.closeReport.addEventListener("click", () => closeDialog(elements.reportDialog));
  elements.reportThreadButton.addEventListener("click", () => {
    openReportDialog({
      targetType: "thread",
      threadId,
      targetId: threadId,
      title: "スレ通報",
    });
  });

  for (const button of document.querySelectorAll("[data-mod-action]")) {
    button.addEventListener("click", async () => {
      try {
        await runModerationAction(button);
      } catch (error) {
        setFeedback(elements.commentFeedback, parseCooldown(error));
      }
    });
  }

  elements.reportDialog.addEventListener("click", (event) => {
    const rect = elements.reportDialog.getBoundingClientRect();
    const inBounds =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;

    if (!inBounds) {
      closeDialog(elements.reportDialog);
    }
  });
}

async function initialize() {
  bindEvents();

  try {
    await loadPage();
  } catch (error) {
    console.error(error);
    renderNotFound(error.message);
  }
}

initialize();
