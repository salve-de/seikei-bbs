(() => {
  const numberFormat = new Intl.NumberFormat("ja-JP");

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "request_failed");
    }

    return payload;
  }

  function relativeTime(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);

    if (diffMinutes < 1) {
      return "今";
    }

    if (diffMinutes < 60) {
      return `${diffMinutes}分前`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}時間前`;
    }

    return `${Math.round(diffHours / 24)}日前`;
  }

  function formatTimestamp(value) {
    if (!value) {
      return "-";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function parseCooldown(error) {
    if (error.message.includes("cooldown")) {
      return "連投制限中です。";
    }

    if (error.message === "thread_locked") {
      return "ロック中です。";
    }

    if (error.message === "thread_not_found") {
      return "スレッドが見つかりません。";
    }

    if (error.message === "room_not_found") {
      return "部屋が見つかりません。";
    }

    return error.message;
  }

  function roomLabel(rooms, roomId) {
    return rooms.find((room) => room.id === roomId)?.label || roomId;
  }

  function renderRoomTabs(container, rooms, activeRoomId) {
    if (!container) {
      return;
    }

    container.innerHTML = [
      `<a class="room-tab${activeRoomId ? "" : " is-active"}" href="/">全体</a>`,
      ...rooms.map((room) => {
        const active = room.id === activeRoomId ? " is-active" : "";
        return `<a class="room-tab${active}" href="/room/${room.id}">${escapeHtml(room.label)}</a>`;
      }),
    ].join("");
  }

  function renderBadges(thread) {
    const badges = [];

    if (thread.megathread) badges.push(`<span class="badge">メガ</span>`);
    if (thread.pinned) badges.push(`<span class="badge">固定</span>`);
    if (thread.locked) badges.push(`<span class="badge">ロック</span>`);
    if (thread.slowModeSeconds) badges.push(`<span class="badge">slow ${thread.slowModeSeconds}</span>`);
    if (thread.pendingReportsCount) {
      badges.push(`<span class="badge badge-danger">通報 ${thread.pendingReportsCount}</span>`);
    }

    return badges.join("");
  }

  function renderTags(tags) {
    return (tags || [])
      .map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`)
      .join("");
  }

  function renderThreadRows(threads, rooms, options = {}) {
    const { showRoom = false, emptyMessage = "項目がありません。" } = options;

    if (!threads.length) {
      return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    }

    const middleLabel = showRoom ? "部屋" : "投稿者";

    return `
      <div class="flat-table thread-table">
        <div class="flat-table-head">
          <span>スレ</span>
          <span>${middleLabel}</span>
          <span>勢い</span>
          <span>レス</span>
          <span>更新</span>
        </div>
        ${threads
          .map((thread) => {
            const middleValue = showRoom
              ? roomLabel(rooms, thread.room)
              : escapeHtml(thread.author || "名無しさん");

            return `
              <a class="flat-table-row thread-row" href="/thread/${thread.id}">
                <div class="thread-main">
                  <strong>${escapeHtml(thread.title)}</strong>
                  <div class="inline-row">${renderBadges(thread)} ${renderTags(thread.tags)}</div>
                </div>
                <div>${middleValue}</div>
                <div class="numeric-cell">${numberFormat.format(thread.heat || 0)}</div>
                <div class="numeric-cell">${numberFormat.format(thread.commentCount || 0)}</div>
                <div class="numeric-cell">${escapeHtml(relativeTime(thread.lastActivityAt || thread.createdAt))}</div>
              </a>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function setFeedback(element, message, tone = "error") {
    if (!element) {
      return;
    }

    if (!message) {
      element.hidden = true;
      element.textContent = "";
      element.dataset.tone = "";
      return;
    }

    element.hidden = false;
    element.dataset.tone = tone;
    element.textContent = message;
  }

  window.BoardShared = {
    escapeHtml,
    requestJson,
    relativeTime,
    formatTimestamp,
    parseCooldown,
    numberFormat,
    roomLabel,
    renderRoomTabs,
    renderBadges,
    renderTags,
    renderThreadRows,
    setFeedback,
  };
})();
