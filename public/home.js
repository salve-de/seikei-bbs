const {
  escapeHtml, requestJson, numberFormat, relativeTime, roomLabel, renderRoomTabs,
  renderTarget, isWatched, readLocal,
} = window.BoardShared;

const requestedBoard = new URL(location.href).searchParams.get("board");
const state = { payload: null, tab: "hot", board: ["politics", "economy", "live"].includes(requestedBoard) ? requestedBoard : "all" };
const el = Object.fromEntries(["roomTabs", "boardSwitch", "feedTabs", "threadFeed", "featuredPoliticians", "roomDirectory", "homeCounts"].map((id) => [id, document.getElementById(id)]));
const tabs = [
  { id: "hot", label: "勢い" },
  { id: "new", label: "新着" },
  { id: "arguing", label: "言い合い中" },
  { id: "watch", label: "ウォッチ中" },
];

function allThreads() {
  const map = new Map();
  for (const key of ["hotThreads", "newestThreads", "arguingThreads", "dailyIssues"]) {
    for (const thread of state.payload.featured[key] || []) map.set(thread.id, thread);
  }
  return [...map.values()];
}

function activeThreads() {
  let threads = state.tab === "new" ? state.payload.featured.newestThreads : state.tab === "arguing" ? state.payload.featured.arguingThreads : state.tab === "watch" ? allThreads().filter((thread) => isWatched(thread.id)) : state.payload.featured.hotThreads;
  if (state.board !== "all") {
    const board = state.payload.boards.find((item) => item.id === state.board);
    threads = threads.filter((thread) => board?.roomIds.includes(thread.room));
  }
  return threads;
}

function renderSwitches() {
  const boards = [{ id: "all", label: "全体", threadCount: state.payload.meta.totalThreads }, ...state.payload.boards];
  el.boardSwitch.innerHTML = boards.map((board) => `<button type="button" data-board="${board.id}" class="board-switch-button${state.board === board.id ? " is-active" : ""}"><strong>${escapeHtml(board.label)}</strong><span>${numberFormat.format(board.threadCount || 0)}スレ</span></button>`).join("");
  el.boardSwitch.querySelectorAll("[data-board]").forEach((button) => button.addEventListener("click", () => { state.board = button.dataset.board; renderSwitches(); renderFeed(); }));
  el.feedTabs.innerHTML = tabs.map((tab) => `<button type="button" data-tab="${tab.id}" class="segment${state.tab === tab.id ? " is-active" : ""}">${tab.label}</button>`).join("");
  el.feedTabs.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.tab = button.dataset.tab; renderSwitches(); renderFeed(); }));
}

function renderFeed() {
  const threads = activeThreads();
  const lastSeen = readLocal("lastSeenComments", {});
  if (!threads.length) {
    el.threadFeed.innerHTML = '<p class="empty-state">ここにはまだ会話がありません。</p>';
    return;
  }
  el.threadFeed.innerHTML = threads.map((thread) => {
    const unread = Math.max(0, Number(thread.lastCommentNo || 0) - Number(lastSeen[thread.id] || 0));
    return `<a class="conversation-row" href="/thread/${thread.id}">
      <div class="conversation-row-main"><div class="inline-row"><span class="badge">${escapeHtml(roomLabel(state.payload.rooms, thread.room))}</span>${renderTarget(thread.target)}${thread.mode === "opposition-welcome" ? '<span class="badge badge-danger">反対歓迎</span>' : ""}</div><strong>${escapeHtml(thread.title)}</strong><p>${escapeHtml(thread.latestExcerpt || thread.summary)}</p></div>
      <div class="conversation-row-stats"><span><strong>${numberFormat.format(thread.heat || 0)}</strong>勢い</span><span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span><span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span>${unread ? `<b>+${numberFormat.format(unread)}</b>` : `<small>${relativeTime(thread.lastActivityAt)}</small>`}</div>
    </a>`;
  }).join("");
}

function renderRooms() {
  el.roomDirectory.innerHTML = state.payload.rooms.map((room) => `<a class="sidebar-link" href="/room/${room.id}"><strong>${escapeHtml(room.label)}</strong><span>${numberFormat.format(room.commentCount || 0)}レス</span></a>`).join("");
}

function renderPoliticians() {
  el.featuredPoliticians.innerHTML = (state.payload.featured.politicians || []).map((politician) => `<a class="politician-list-row" href="/politician/${politician.id}"><span class="politician-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span><span class="politician-list-copy"><strong>${escapeHtml(politician.name)}</strong><span>${escapeHtml(politician.groupShort)}</span></span><span class="politician-activity">${numberFormat.format(politician.commentCount)}<small>レス</small></span></a>`).join("");
}

async function initialize() {
  state.payload = await requestJson("/api/home");
  renderRoomTabs(el.roomTabs, state.payload.rooms, state.board);
  renderSwitches();
  renderFeed();
  renderPoliticians();
  renderRooms();
  el.homeCounts.textContent = `${numberFormat.format(state.payload.meta.totalThreads)}スレ · ${numberFormat.format(state.payload.meta.totalComments)}レス`;
}

initialize().catch((error) => { console.error(error); el.threadFeed.innerHTML = '<p class="empty-state">読み込めませんでした。</p>'; });
