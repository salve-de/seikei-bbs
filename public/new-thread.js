const {
  escapeHtml,
  requestJson,
  renderRoomTabs,
  renderBadges,
  setFeedback,
  parseCooldown,
} = window.BoardShared;

const url = new URL(window.location.href);
const requestedRoom = url.searchParams.get("room") || "";

const state = {
  board: null,
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  composerForm: document.getElementById("composerForm"),
  composerRoom: document.getElementById("composerRoom"),
  composerAuthor: document.getElementById("composerAuthor"),
  composerTitle: document.getElementById("composerTitle"),
  composerSummary: document.getElementById("composerSummary"),
  composerBody: document.getElementById("composerBody"),
  composerTags: document.getElementById("composerTags"),
  composerSourceUrl: document.getElementById("composerSourceUrl"),
  composerMegathread: document.getElementById("composerMegathread"),
  composerFeedback: document.getElementById("composerFeedback"),
  duplicateSection: document.getElementById("duplicateSection"),
  duplicateList: document.getElementById("duplicateList"),
};

function currentRoomId() {
  return elements.composerRoom.value;
}

function populateRooms() {
  elements.composerRoom.innerHTML = state.board.rooms
    .map((room) => `<option value="${room.id}">${escapeHtml(room.label)}</option>`)
    .join("");

  if (requestedRoom && state.board.rooms.some((room) => room.id === requestedRoom)) {
    elements.composerRoom.value = requestedRoom;
  }
}

function duplicateCandidates() {
  const room = currentRoomId();
  const query = [elements.composerTitle.value, elements.composerSummary.value]
    .join(" ")
    .trim()
    .toLowerCase();

  const roomThreads = state.board.threads.filter((thread) => thread.room === room);

  if (!query) {
    return roomThreads.slice(0, 5);
  }

  return roomThreads
    .filter((thread) =>
      [thread.title, thread.summary, ...(thread.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(query)
    )
    .slice(0, 5);
}

function renderDuplicates() {
  const candidates = duplicateCandidates();
  elements.duplicateSection.hidden = candidates.length === 0;

  if (!candidates.length) {
    elements.duplicateList.innerHTML = "";
    return;
  }

  elements.duplicateList.innerHTML = candidates
    .map(
      (thread) => `
        <a class="flat-list-row compact-row" href="/thread/${thread.id}">
          <div class="row-main">
            <strong>${escapeHtml(thread.title)}</strong>
            <div class="inline-row">${renderBadges(thread)}</div>
          </div>
        </a>
      `
    )
    .join("");
}

async function submitThread(event) {
  event.preventDefault();
  setFeedback(elements.composerFeedback, "");

  try {
    const payload = await requestJson("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        room: elements.composerRoom.value,
        author: elements.composerAuthor.value,
        title: elements.composerTitle.value,
        summary: elements.composerSummary.value,
        body: elements.composerBody.value,
        tags: elements.composerTags.value,
        sourceUrl: elements.composerSourceUrl.value,
        megathread: elements.composerMegathread.checked,
      }),
    });

    window.location.href = `/thread/${payload.thread.id}`;
  } catch (error) {
    setFeedback(elements.composerFeedback, parseCooldown(error));
  }
}

function bindEvents() {
  elements.composerForm.addEventListener("submit", submitThread);
  elements.composerRoom.addEventListener("change", () => {
    renderRoomTabs(elements.roomTabs, state.board.rooms, currentRoomId());
    renderDuplicates();
  });
  elements.composerTitle.addEventListener("input", renderDuplicates);
  elements.composerSummary.addEventListener("input", renderDuplicates);
}

async function initialize() {
  state.board = await requestJson("/api/board");
  populateRooms();
  renderRoomTabs(elements.roomTabs, state.board.rooms, currentRoomId());
  renderDuplicates();
  bindEvents();
}

initialize().catch((error) => {
  console.error(error);
  setFeedback(elements.composerFeedback, escapeHtml(error.message));
});
