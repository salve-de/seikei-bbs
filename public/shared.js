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
    const actorToken = getActorToken();
    const headers = new Headers(options?.headers || {});
    headers.set("x-board-actor", actorToken);
    const response = await fetch(url, { ...options, headers });
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

  function formatDate(value) {
    if (!value) {
      return "-";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00+09:00`));
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

    if (error.message === "politician_not_found") {
      return "議員が見つかりません。";
    }

    if (error.message === "invalid_source_url") {
      return "有効な http または https の出典URLを入力してください。";
    }

    if (error.message === "invalid_thread_target") {
      return "話題の対象を入力してください。";
    }

    if (error.message === "invalid_reaction") {
      return "リアクションを選び直してください。";
    }

    if (error.message === "fact_requires_source") {
      return "入力内容を確認してください。";
    }

    if (error.message === "invalid_impact_areas") {
      return "選択内容を確認してください。";
    }

    if (error.message === "invalid_decision_prompt") {
      return "入力内容を確認してください。";
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

    const politicsRooms = new Set(["money", "security", "election"]);
    const economyRooms = new Set(["tax", "prices", "boj"]);
    const activeBoard = ["politics", "economy", "live"].includes(activeRoomId)
      ? activeRoomId
      : politicsRooms.has(activeRoomId)
        ? "politics"
        : economyRooms.has(activeRoomId)
          ? "economy"
          : "all";
    const boards = [
      { id: "all", label: "全体", href: "/" },
      { id: "politics", label: "政治総合", href: "/?board=politics" },
      { id: "economy", label: "生活と経済", href: "/?board=economy" },
      { id: "live", label: "実況・速報", href: "/?board=live" },
    ];
    container.innerHTML = boards.map((board) =>
      `<a class="room-tab${activeBoard === board.id ? " is-active" : ""}" href="${board.href}">${board.label}</a>`
    ).join("");
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

  function renderTarget(target) {
    if (!target?.label) {
      return "";
    }

    const content = `${escapeHtml(target.typeLabel)}: ${escapeHtml(target.label)}`;
    return `<span class="target-chip">${content}</span>`;
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
                  <div class="inline-row">${renderBadges(thread)} ${renderTarget(thread.target)} ${renderTags(thread.tags)}</div>
                </div>
                <div>${middleValue}</div>
                <div class="numeric-cell">${numberFormat.format(thread.heat || 0)}</div>
                <div class="numeric-cell">${numberFormat.format(thread.commentCount || 0)}</div>
                <div class="numeric-cell">${escapeHtml(relativeTime(thread.lastActivityAt))}</div>
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

  function readLocal(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(`seikei:${key}`));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    localStorage.setItem(`seikei:${key}`, JSON.stringify(value));
  }

  function getActorToken() {
    const stored = localStorage.getItem("seikei:actorToken");
    if (stored) return stored;
    const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("seikei:actorToken", token);
    return token;
  }

  function isWatched(threadId) {
    return readLocal("watchedThreads", []).includes(threadId);
  }

  function toggleWatch(threadId) {
    const watched = new Set(readLocal("watchedThreads", []));
    if (watched.has(threadId)) watched.delete(threadId);
    else watched.add(threadId);
    const next = [...watched];
    writeLocal("watchedThreads", next);
    return next.includes(threadId);
  }

  function rememberAction(kind, id, value) {
    const actions = readLocal(kind, {});
    actions[id] = value;
    writeLocal(kind, actions);
  }

  function rememberedAction(kind, id) {
    return readLocal(kind, {})[id] || "";
  }

  window.BoardShared = {
    escapeHtml,
    requestJson,
    relativeTime,
    formatTimestamp,
    formatDate,
    parseCooldown,
    numberFormat,
    roomLabel,
    renderRoomTabs,
    renderBadges,
    renderTags,
    renderTarget,
    renderThreadRows,
    setFeedback,
    readLocal,
    writeLocal,
    getActorToken,
    isWatched,
    toggleWatch,
    rememberAction,
    rememberedAction,
  };
})();
