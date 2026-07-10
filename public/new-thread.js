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
const requestedTargetType = url.searchParams.get("targetType") || "";
const requestedTargetId = url.searchParams.get("targetId") || "";

const state = {
  board: null,
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  composerForm: document.getElementById("composerForm"),
  composerRoom: document.getElementById("composerRoom"),
  composerAuthor: document.getElementById("composerAuthor"),
  composerTargetType: document.getElementById("composerTargetType"),
  composerTargetId: document.getElementById("composerTargetId"),
  composerTargetLabel: document.getElementById("composerTargetLabel"),
  composerPoliticianField: document.getElementById("composerPoliticianField"),
  composerTargetLabelField: document.getElementById("composerTargetLabelField"),
  composerTitle: document.getElementById("composerTitle"),
  composerSummary: document.getElementById("composerSummary"),
  composerDecisionPrompt: document.getElementById("composerDecisionPrompt"),
  composerImpacts: document.getElementById("composerImpacts"),
  composerBody: document.getElementById("composerBody"),
  composerTags: document.getElementById("composerTags"),
  composerSourceUrl: document.getElementById("composerSourceUrl"),
  composerSourceKind: document.getElementById("composerSourceKind"),
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

function populateTargets() {
  elements.composerTargetType.innerHTML = state.board.targetDefinitions
    .map((target) => `<option value="${target.id}">${escapeHtml(target.label)}</option>`)
    .join("");
  elements.composerTargetId.innerHTML = state.board.politicians
    .map(
      (politician) =>
        `<option value="${politician.id}">${escapeHtml(politician.name)} / ${escapeHtml(
          politician.groupShort
        )} / ${escapeHtml(politician.district)}</option>`
    )
    .join("");

  if (state.board.targetDefinitions.some((target) => target.id === requestedTargetType)) {
    elements.composerTargetType.value = requestedTargetType;
  }
  if (state.board.politicians.some((politician) => politician.id === requestedTargetId)) {
    elements.composerTargetId.value = requestedTargetId;
  }
  updateTargetFields();
}

function populateImpacts() {
  elements.composerImpacts.innerHTML = state.board.impactDefinitions
    .map((impact) => `<label><input type="checkbox" value="${impact.id}" /><span>${escapeHtml(impact.label)}</span></label>`)
    .join("");
}

function updateTargetFields() {
  const politicianSelected = elements.composerTargetType.value === "politician";
  elements.composerPoliticianField.hidden = !politicianSelected;
  elements.composerTargetLabelField.hidden = politicianSelected;
  elements.composerTargetId.disabled = !politicianSelected;
  elements.composerTargetLabel.disabled = politicianSelected;
  elements.composerTargetLabel.required = !politicianSelected;
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
        decisionPrompt: elements.composerDecisionPrompt.value,
        impactAreas: [...elements.composerImpacts.querySelectorAll("input:checked")].map((input) => input.value),
        body: elements.composerBody.value,
        tags: elements.composerTags.value,
        sourceUrl: elements.composerSourceUrl.value,
        sourceKind: elements.composerSourceKind.value,
        targetType: elements.composerTargetType.value,
        targetId: elements.composerTargetId.value,
        targetLabel: elements.composerTargetLabel.value,
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
  elements.composerTargetType.addEventListener("change", updateTargetFields);
  elements.composerTitle.addEventListener("input", renderDuplicates);
  elements.composerSummary.addEventListener("input", renderDuplicates);
}

async function initialize() {
  state.board = await requestJson("/api/board");
  populateRooms();
  populateTargets();
  populateImpacts();
  renderRoomTabs(elements.roomTabs, state.board.rooms, currentRoomId());
  renderDuplicates();
  bindEvents();
}

initialize().catch((error) => {
  console.error(error);
  setFeedback(elements.composerFeedback, escapeHtml(error.message));
});
