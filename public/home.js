const {
  escapeHtml,
  requestJson,
  numberFormat,
  relativeTime,
  roomLabel,
  renderRoomTabs,
  renderTarget,
  isWatched,
  readLocal,
  setFeedback,
  parseCooldown,
} = window.BoardShared;

const requestedBoard = new URL(location.href).searchParams.get("board");
const state = {
  payload: null,
  boardPayload: null,
  tab: "hot",
  board: ["politics", "economy", "live"].includes(requestedBoard) ? requestedBoard : "all",
  arenaDetails: new Map(),
  searchIndex: [],
};

const ids = [
  "roomTabs",
  "boardSwitch",
  "feedTabs",
  "threadFeed",
  "featuredPoliticians",
  "featuredTopics",
  "roomDirectory",
  "homeCounts",
  "hotArenas",
  "latestTopics",
  "showNewestButton",
  "siteSearchForm",
  "siteSearchInput",
  "searchResults",
  "popularSearches",
  "quickPostForm",
  "quickBody",
  "quickRoom",
  "quickSource",
  "quickSubmit",
  "quickPostFeedback",
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const tabs = [
  { id: "hot", label: "勢い" },
  { id: "new", label: "最新" },
  { id: "live", label: "速報・実況" },
  { id: "source", label: "資料あり" },
  { id: "unanswered", label: "返信なし" },
  { id: "watch", label: "ウォッチ" },
];

function truncate(value, max = 90) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function allThreads() {
  const map = new Map();
  const groups = [
    state.boardPayload?.threads,
    state.payload?.featured?.hotThreads,
    state.payload?.featured?.newestThreads,
    state.payload?.featured?.dailyIssues,
  ];
  for (const group of groups) {
    for (const thread of group || []) map.set(thread.id, thread);
  }
  return [...map.values()];
}

function roomsForBoard(boardId) {
  if (boardId === "all") return state.payload.rooms.map((room) => room.id);
  return state.payload.boards.find((board) => board.id === boardId)?.roomIds || [];
}

function filterByBoard(threads) {
  if (state.board === "all") return threads;
  const roomIds = new Set(roomsForBoard(state.board));
  return threads.filter((thread) => roomIds.has(thread.room));
}

function activeThreads() {
  const everyThread = allThreads();
  let threads;

  if (state.tab === "new") threads = state.payload.featured.newestThreads || [];
  else if (state.tab === "watch") threads = everyThread.filter((thread) => isWatched(thread.id));
  else if (state.tab === "unanswered") threads = everyThread.filter((thread) => Number(thread.commentCount || 0) === 0);
  else if (state.tab === "source") threads = everyThread.filter((thread) => Boolean(thread.sourceUrl));
  else if (state.tab === "live") {
    const liveRooms = new Set(roomsForBoard("live"));
    threads = everyThread.filter((thread) => liveRooms.has(thread.room) || (thread.tags || []).includes("実況"));
  } else threads = state.payload.featured.hotThreads || [];

  return filterByBoard(threads);
}

function selectDefaultRoom() {
  const preferred = roomsForBoard(state.board)[0];
  if (preferred && [...el.quickRoom.options].some((option) => option.value === preferred)) {
    el.quickRoom.value = preferred;
  }
}

function renderSwitches() {
  const boards = [
    { id: "all", label: "全体", threadCount: state.payload.meta.totalThreads },
    ...state.payload.boards,
  ];

  el.boardSwitch.innerHTML = boards
    .map(
      (board) => `<button type="button" data-board="${board.id}" class="board-switch-button${state.board === board.id ? " is-active" : ""}">
        <strong>${escapeHtml(board.label)}</strong>
        <span>${numberFormat.format(board.threadCount || 0)}スレ</span>
      </button>`
    )
    .join("");

  el.boardSwitch.querySelectorAll("[data-board]").forEach((button) =>
    button.addEventListener("click", () => {
      state.board = button.dataset.board;
      renderRoomTabs(el.roomTabs, state.payload.rooms, state.board);
      selectDefaultRoom();
      renderSwitches();
      renderFeed();
    })
  );

  el.feedTabs.innerHTML = tabs
    .map((tab) => `<button type="button" data-tab="${tab.id}" class="segment${state.tab === tab.id ? " is-active" : ""}">${tab.label}</button>`)
    .join("");

  el.feedTabs.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderSwitches();
      renderFeed();
    })
  );
}

function threadSignals(thread) {
  const signals = [];
  const liveRooms = new Set(roomsForBoard("live"));
  if (liveRooms.has(thread.room) || (thread.tags || []).includes("実況")) {
    signals.push('<span class="crowd-status is-live">実況</span>');
  }
  if (thread.sourceUrl) signals.push('<span class="crowd-status is-source">資料あり</span>');
  return signals.join("");
}

function renderFeed() {
  const threads = activeThreads();
  const lastSeen = readLocal("lastSeenComments", {});

  if (!threads.length) {
    const message = state.tab === "unanswered" ? "返信を待っているスレッドはありません。" : "該当するスレッドはありません。";
    el.threadFeed.innerHTML = `<p class="empty-state">${message}</p>`;
    return;
  }

  el.threadFeed.innerHTML = threads
    .map((thread) => {
      const unread = Math.max(0, Number(thread.lastCommentNo || 0) - Number(lastSeen[thread.id] || 0));
      return `<a class="conversation-row" href="/thread/${thread.id}">
        <div class="conversation-row-main">
          <div class="inline-row">
            <span class="badge">${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span>
            ${renderTarget(thread.target)}
            ${threadSignals(thread)}
          </div>
          <strong>${escapeHtml(thread.title)}</strong>
          <p>${escapeHtml(truncate(thread.latestExcerpt || thread.summary || thread.body, 120))}</p>
        </div>
        <div class="conversation-row-stats">
          <span><strong>${numberFormat.format(thread.heat || 0)}</strong>勢い</span>
          <span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span>
          <span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span>
          ${unread ? `<b>+${numberFormat.format(unread)}未読</b>` : `<small>${relativeTime(thread.lastActivityAt)}</small>`}
        </div>
      </a>`;
    })
    .join("");
}

function renderLatestTopics() {
  const threads = (state.payload.featured.newestThreads || []).slice(0, 4);
  if (!threads.length) {
    el.latestTopics.innerHTML = '<p class="empty-state">最新の投稿はありません。</p>';
    return;
  }

  el.latestTopics.innerHTML = threads
    .map(
      (thread) => `<a class="current-topic-card" href="/thread/${thread.id}">
        <div class="current-topic-meta">
          <span>${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span>
          <span>${relativeTime(thread.lastActivityAt)}</span>
          ${threadSignals(thread)}
        </div>
        <strong>${escapeHtml(thread.title)}</strong>
        <div class="current-topic-meta"><span>${numberFormat.format(thread.commentCount || 0)}レス</span><span>${numberFormat.format(thread.participantCount || 0)}人</span></div>
      </a>`
    )
    .join("");
}

function recentVoices(detail) {
  return [...(detail?.comments || [])]
    .sort((a, b) => Number(b.number || 0) - Number(a.number || 0))
    .slice(0, 2)
    .map((comment) => ({ body: truncate(comment.body, 94) }));
}

function renderHotArenas() {
  const threads = (state.payload.featured.hotThreads || []).slice(0, 3);
  if (!threads.length) {
    el.hotArenas.innerHTML = '<p class="empty-state">まだ盛り上がっているスレッドはありません。</p>';
    return;
  }

  el.hotArenas.innerHTML = threads
    .map((thread, index) => {
      const detail = state.arenaDetails.get(thread.id);
      const voices = recentVoices(detail);
      const fallback = truncate(thread.latestExcerpt || thread.summary || "最初の投稿を待っています。", 94);
      const renderedVoices = (voices.length ? voices : [{ body: fallback }])
        .map((voice) => `<div class="arena-voice">「${escapeHtml(voice.body)}」</div>`)
        .join("");

      return `<a class="hot-arena-card" href="/thread/${thread.id}">
        <div class="hot-arena-main">
          <div class="hot-arena-kicker"><span>${index + 1}位</span><span>${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span></div>
          <h3>${escapeHtml(thread.title)}</h3>
          <div class="hot-arena-meta">${renderTarget(thread.target)} ${threadSignals(thread)}</div>
        </div>
        <div class="arena-voices">${renderedVoices}</div>
        <div class="hot-arena-stats">
          <span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span>
          <span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span>
          <span>更新 ${relativeTime(thread.lastActivityAt)}</span>
        </div>
      </a>`;
    })
    .join("");
}

async function hydrateArenaDetails() {
  const threads = (state.payload.featured.hotThreads || []).slice(0, 3);
  await Promise.all(
    threads.map(async (thread) => {
      try {
        const detail = await requestJson(`/api/threads/${encodeURIComponent(thread.id)}`);
        state.arenaDetails.set(thread.id, detail);
      } catch (error) {
        console.warn("thread detail unavailable", thread.id, error);
      }
    })
  );
  renderHotArenas();
}

function renderRooms() {
  el.roomDirectory.innerHTML = state.payload.rooms
    .map(
      (room) => `<a class="sidebar-link" href="/room/${room.id}">
        <strong>${escapeHtml(room.label)}</strong>
        <span>${numberFormat.format(room.commentCount || 0)}レス</span>
      </a>`
    )
    .join("");
}

function activePoliticians() {
  return [...(state.boardPayload.politicians || [])]
    .filter((politician) => Number(politician.activityCount || 0) > 0)
    .sort((left, right) => Number(right.activityCount || 0) - Number(left.activityCount || 0));
}

function renderPoliticians() {
  const politicians = activePoliticians().slice(0, 6);
  if (!politicians.length) {
    el.featuredPoliticians.innerHTML = '<p class="sidebar-empty">投稿がある政治家はまだいません。</p>';
    return;
  }

  el.featuredPoliticians.innerHTML = politicians
    .map(
      (politician) => `<a class="politician-list-row" href="/politician/${politician.id}">
        <span class="politician-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span>
        <span class="politician-list-copy"><strong>${escapeHtml(politician.name)}</strong><span>${escapeHtml(politician.groupShort)}</span></span>
        <span class="politician-activity">${numberFormat.format(politician.commentCount || 0)}<small>レス</small></span>
      </a>`
    )
    .join("");
}

function topicThreads(topic) {
  return allThreads().filter(
    (thread) =>
      thread.target?.id === topic.id ||
      thread.target?.label === topic.targetLabel ||
      (thread.tags || []).includes(topic.name)
  );
}

function activeTopics() {
  return (window.TopicDefinitions || [])
    .map((topic) => {
      const threads = topicThreads(topic);
      const score = threads.reduce((sum, thread) => sum + Number(thread.heat || 0) + Number(thread.commentCount || 0) * 3, 0);
      return { ...topic, threads, score };
    })
    .filter((topic) => topic.score > 0)
    .sort((left, right) => right.score - left.score);
}

function renderTopics() {
  const topics = activeTopics().slice(0, 6);
  if (!topics.length) {
    el.featuredTopics.innerHTML = '<p class="sidebar-empty">投稿があるテーマはまだありません。</p>';
    return;
  }

  el.featuredTopics.innerHTML = topics
    .map((topic) => {
      const comments = topic.threads.reduce((sum, thread) => sum + Number(thread.commentCount || 0), 0);
      return `<a class="sidebar-link" href="/topic.html?id=${encodeURIComponent(topic.id)}"><strong>${escapeHtml(topic.name)}</strong><span>${numberFormat.format(comments)}レス</span></a>`;
    })
    .join("");
}

function populateQuickRooms() {
  el.quickRoom.innerHTML = state.payload.rooms
    .map((room) => `<option value="${room.id}">${escapeHtml(room.label)}</option>`)
    .join("");
  selectDefaultRoom();
}

function deriveTitle(body, kind) {
  const normalized = String(body || "").replace(/\s+/g, " ").trim();
  let title = normalized.split(/[。！？!?]/)[0].trim();
  if (title.length < 4) title = normalized.slice(0, 70);
  if (title.length < 4) title = `${kind}について話そう`;
  return title.slice(0, 120);
}

async function submitQuickPost(event) {
  event.preventDefault();
  setFeedback(el.quickPostFeedback, "");

  const body = el.quickBody.value.trim();
  const sourceUrl = el.quickSource.value.trim();
  const kind = new FormData(el.quickPostForm).get("quickKind") || "一言";
  if (body.length < 2) {
    setFeedback(el.quickPostFeedback, "本文を入力してください。");
    el.quickBody.focus();
    return;
  }

  el.quickSubmit.disabled = true;
  el.quickSubmit.textContent = "作成中…";

  try {
    const payload = await requestJson("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        room: el.quickRoom.value,
        author: "",
        mode: "mixed",
        title: deriveTitle(body, kind),
        summary: "",
        decisionPrompt: kind === "質問" ? body.slice(0, 180) : "",
        impactAreas: [],
        body,
        tags: kind,
        sourceUrl,
        sourceKind: sourceUrl ? "other" : "",
        targetType: "",
        targetId: "",
        targetLabel: "",
        megathread: kind === "実況",
      }),
    });
    window.location.href = `/thread/${payload.thread.id}`;
  } catch (error) {
    setFeedback(el.quickPostFeedback, parseCooldown(error));
    el.quickSubmit.disabled = false;
    el.quickSubmit.textContent = "スレッドを立てる";
  }
}

function buildSearchIndex() {
  const items = [];

  for (const politician of state.boardPayload.politicians || []) {
    items.push({
      type: "政治家",
      title: politician.name,
      subtitle: `${politician.groupShort} · ${politician.district}`,
      keywords: [politician.name, politician.nameKana, politician.group, politician.groupShort, politician.district].join(" ").toLowerCase(),
      href: `/politician/${politician.id}`,
      score: Number(politician.activityCount || 0),
    });
  }

  for (const topic of window.TopicDefinitions || []) {
    const activity = activeTopics().find((item) => item.id === topic.id);
    items.push({
      type: "テーマ",
      title: topic.name,
      subtitle: topic.category,
      keywords: [topic.name, topic.category, topic.description].join(" ").toLowerCase(),
      href: `/topic.html?id=${encodeURIComponent(topic.id)}`,
      score: Number(activity?.score || 0),
    });
  }

  for (const thread of allThreads()) {
    items.push({
      type: "スレッド",
      title: thread.title,
      subtitle: `${roomLabel(state.payload.rooms, thread.room)} · ${relativeTime(thread.lastActivityAt)}`,
      keywords: [thread.title, thread.summary, thread.body, thread.target?.label, ...(thread.tags || [])].join(" ").toLowerCase(),
      href: `/thread/${thread.id}`,
      score: Number(thread.heat || 0) + Number(thread.commentCount || 0),
    });
  }

  state.searchIndex = items;
}

function searchItems(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return [];
  return state.searchIndex
    .filter((item) => item.keywords.includes(normalized) || item.title.toLowerCase().includes(normalized))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

function renderSearchResults(query) {
  const results = searchItems(query);
  if (!query.trim()) {
    el.searchResults.hidden = true;
    el.searchResults.innerHTML = "";
    return;
  }

  el.searchResults.hidden = false;
  if (!results.length) {
    el.searchResults.innerHTML = '<p class="empty-state">見つかりませんでした。</p>';
    return;
  }

  el.searchResults.innerHTML = results
    .map(
      (item) => `<a class="search-result-row" href="${item.href}">
        <span class="search-result-type">${escapeHtml(item.type)}</span>
        <span class="search-result-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.subtitle)}</span></span>
        <span aria-hidden="true">›</span>
      </a>`
    )
    .join("");
}

function renderPopularSearches() {
  const candidates = [];
  for (const politician of activePoliticians().slice(0, 3)) {
    candidates.push({ label: politician.name, href: `/politician/${politician.id}`, score: Number(politician.activityCount || 0) });
  }
  for (const topic of activeTopics().slice(0, 3)) {
    candidates.push({ label: topic.name, href: `/topic.html?id=${encodeURIComponent(topic.id)}`, score: topic.score });
  }

  const seen = new Set();
  const popular = candidates
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.label)) return false;
      seen.add(item.label);
      return true;
    })
    .slice(0, 5);

  if (!popular.length) {
    el.popularSearches.innerHTML = '<span>人気の人物・テーマは投稿状況に応じて表示されます。</span>';
    return;
  }

  el.popularSearches.innerHTML = `<span>人気:</span>${popular
    .map((item) => `<a class="popular-chip" href="${item.href}">${escapeHtml(item.label)}</a>`)
    .join("")}`;
}

function bindSearch() {
  el.siteSearchInput.addEventListener("input", () => renderSearchResults(el.siteSearchInput.value));
  el.siteSearchInput.addEventListener("focus", () => renderSearchResults(el.siteSearchInput.value));
  el.siteSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const first = searchItems(el.siteSearchInput.value)[0];
    if (first) window.location.href = first.href;
    else renderSearchResults(el.siteSearchInput.value);
  });
  document.addEventListener("click", (event) => {
    if (!el.siteSearchForm.contains(event.target)) el.searchResults.hidden = true;
  });
}

function bindEvents() {
  el.quickPostForm.addEventListener("submit", submitQuickPost);
  el.quickPostForm.querySelectorAll('input[name="quickKind"]').forEach((input) =>
    input.addEventListener("change", () => {
      if (input.value !== "実況") return;
      const liveRoom = roomsForBoard("live")[0];
      if (liveRoom) el.quickRoom.value = liveRoom;
    })
  );
  el.showNewestButton.addEventListener("click", () => {
    state.tab = "new";
    renderSwitches();
    renderFeed();
    el.feedTabs.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  bindSearch();
}

async function initialize() {
  [state.payload, state.boardPayload] = await Promise.all([
    requestJson("/api/home"),
    requestJson("/api/board"),
  ]);
  renderRoomTabs(el.roomTabs, state.payload.rooms, state.board);
  populateQuickRooms();
  renderSwitches();
  renderFeed();
  renderLatestTopics();
  renderHotArenas();
  renderPoliticians();
  renderTopics();
  renderRooms();
  buildSearchIndex();
  renderPopularSearches();
  bindEvents();
  el.homeCounts.textContent = `${numberFormat.format(state.payload.meta.totalThreads)}スレ · ${numberFormat.format(state.payload.meta.totalComments)}レス`;
  hydrateArenaDetails();
}

initialize().catch((error) => {
  console.error(error);
  el.threadFeed.innerHTML = '<p class="empty-state">読み込めませんでした。</p>';
  el.hotArenas.innerHTML = '<p class="empty-state">読み込めませんでした。</p>';
  el.latestTopics.innerHTML = '<p class="empty-state">読み込めませんでした。</p>';
});
