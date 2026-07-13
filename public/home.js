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
  tab: "hot",
  board: ["politics", "economy", "live"].includes(requestedBoard) ? requestedBoard : "all",
  arenaDetails: new Map(),
};

const ids = [
  "roomTabs",
  "boardSwitch",
  "feedTabs",
  "threadFeed",
  "featuredPoliticians",
  "roomDirectory",
  "homeCounts",
  "hotArenas",
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
  { id: "arguing", label: "言い合い中" },
  { id: "live", label: "実況" },
  { id: "source", label: "資料あり" },
  { id: "unanswered", label: "返信なし" },
  { id: "new", label: "新着" },
  { id: "watch", label: "ウォッチ" },
];

function truncate(value, max = 90) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function allThreads() {
  const map = new Map();
  const groups = [
    state.payload?.threads,
    state.payload?.featured?.hotThreads,
    state.payload?.featured?.newestThreads,
    state.payload?.featured?.arguingThreads,
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
  else if (state.tab === "arguing") threads = state.payload.featured.arguingThreads || [];
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
  if (state.payload.featured.arguingThreads?.some((item) => item.id === thread.id)) {
    signals.push('<span class="crowd-status is-hot">言い合い中</span>');
  }
  if (liveRooms.has(thread.room) || (thread.tags || []).includes("実況")) {
    signals.push('<span class="crowd-status is-live">実況</span>');
  }
  if (thread.sourceUrl) signals.push('<span class="crowd-status is-source">元情報あり</span>');
  return signals.join("");
}

function renderFeed() {
  const threads = activeThreads();
  const lastSeen = readLocal("lastSeenComments", {});

  if (!threads.length) {
    const message = state.tab === "unanswered" ? "返信を待っている会場はありません。" : "ここにはまだ会話がありません。";
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

function pickVoices(detail) {
  const comments = [...(detail?.comments || [])].sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  if (!comments.length) return [];
  const first = comments[0];
  const opposite = comments.find(
    (comment) => comment.id !== first.id && first.stance && comment.stance && comment.stance !== first.stance
  );
  const second = opposite || comments.find((comment) => comment.id !== first.id);
  return [first, second].filter(Boolean).map((comment, index) => ({
    body: truncate(comment.body, 94),
    opposite: index === 1 && Boolean(opposite),
  }));
}

function renderHotArenas() {
  const threads = (state.payload.featured.hotThreads || []).slice(0, 3);
  if (!threads.length) {
    el.hotArenas.innerHTML = '<p class="empty-state">まだ沸いている会場はありません。最初の会場を作ってください。</p>';
    return;
  }

  el.hotArenas.innerHTML = threads
    .map((thread, index) => {
      const detail = state.arenaDetails.get(thread.id);
      const voices = pickVoices(detail);
      const fallback = truncate(thread.latestExcerpt || thread.summary || "最初の意見を待っています。", 94);
      const renderedVoices = (voices.length ? voices : [{ body: fallback, opposite: false }])
        .map((voice) => `<div class="arena-voice${voice.opposite ? " is-opposite" : ""}">「${escapeHtml(voice.body)}」</div>`)
        .join("");

      return `<a class="hot-arena-card" href="/thread/${thread.id}">
        <div class="hot-arena-main">
          <div class="hot-arena-kicker"><span>現在 ${index + 1}位</span><span>${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span></div>
          <h3>${escapeHtml(thread.title)}</h3>
          <div class="hot-arena-meta">${renderTarget(thread.target)} ${threadSignals(thread)}</div>
        </div>
        <div class="arena-voices">${renderedVoices}</div>
        <div class="hot-arena-stats">
          <span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人参加</span>
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
        console.warn("arena detail unavailable", thread.id, error);
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

function renderPoliticians() {
  el.featuredPoliticians.innerHTML = (state.payload.featured.politicians || [])
    .map(
      (politician) => `<a class="politician-list-row" href="/politician/${politician.id}">
        <span class="politician-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span>
        <span class="politician-list-copy"><strong>${escapeHtml(politician.name)}</strong><span>${escapeHtml(politician.groupShort)}</span></span>
        <span class="politician-activity">${numberFormat.format(politician.commentCount || 0)}<small>レス</small></span>
      </a>`
    )
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
    setFeedback(el.quickPostFeedback, "一言だけでも入力してください。");
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
    el.quickSubmit.textContent = "会場を作る";
  }
}

function bindQuickComposer() {
  el.quickPostForm.addEventListener("submit", submitQuickPost);
  el.quickPostForm.querySelectorAll('input[name="quickKind"]').forEach((input) =>
    input.addEventListener("change", () => {
      if (input.value !== "実況") return;
      const liveRoom = roomsForBoard("live")[0];
      if (liveRoom) el.quickRoom.value = liveRoom;
    })
  );
}

async function initialize() {
  state.payload = await requestJson("/api/home");
  renderRoomTabs(el.roomTabs, state.payload.rooms, state.board);
  populateQuickRooms();
  renderSwitches();
  renderFeed();
  renderHotArenas();
  renderPoliticians();
  renderRooms();
  bindQuickComposer();
  el.homeCounts.textContent = `${numberFormat.format(state.payload.meta.totalThreads)}スレ · ${numberFormat.format(state.payload.meta.totalComments)}レス`;
  hydrateArenaDetails();
}

initialize().catch((error) => {
  console.error(error);
  el.threadFeed.innerHTML = '<p class="empty-state">読み込めませんでした。</p>';
  el.hotArenas.innerHTML = '<p class="empty-state">読み込めませんでした。</p>';
});
