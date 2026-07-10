const {
  escapeHtml,
  requestJson,
  relativeTime,
  numberFormat,
  renderRoomTabs,
  renderThreadRows,
} = window.BoardShared;

const roomId = decodeURIComponent(window.location.pathname.split("/").pop() || "");

const state = {
  payload: null,
  search: "",
  sort: "heat",
  onlyMegathreads: false,
  activeTag: "",
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  roomTitle: document.getElementById("roomTitle"),
  roomMeta: document.getElementById("roomMeta"),
  roomSearchInput: document.getElementById("roomSearchInput"),
  roomSortSelect: document.getElementById("roomSortSelect"),
  roomMegathreadToggle: document.getElementById("roomMegathreadToggle"),
  roomNewThreadLink: document.getElementById("roomNewThreadLink"),
  roomTags: document.getElementById("roomTags"),
  roomResultSummary: document.getElementById("roomResultSummary"),
  roomThreadList: document.getElementById("roomThreadList"),
};

function sortThreads(list) {
  return [...list].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    if ((right[state.sort] || 0) !== (left[state.sort] || 0)) {
      return (right[state.sort] || 0) - (left[state.sort] || 0);
    }

    return (
      new Date(right.lastActivityAt || right.createdAt).getTime() -
      new Date(left.lastActivityAt || left.createdAt).getTime()
    );
  });
}

function filteredThreads() {
  const threads = state.payload?.threads || [];
  const query = state.search.trim().toLowerCase();

  return sortThreads(
    threads
      .filter((thread) => !state.onlyMegathreads || thread.megathread)
      .filter((thread) => !state.activeTag || (thread.tags || []).includes(state.activeTag))
      .filter((thread) => {
        if (!query) {
          return true;
        }

        return [thread.title, thread.summary, thread.body, ...(thread.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
  );
}

function renderHeader() {
  const room = state.payload.room;

  elements.roomTitle.textContent = room.label;
  elements.roomMeta.innerHTML = `
    <span>スレ <strong>${numberFormat.format(room.threadCount || 0)}</strong></span>
    <span>レス <strong>${numberFormat.format(room.commentCount || 0)}</strong></span>
    <span>メガ <strong>${numberFormat.format(room.megathreads || 0)}</strong></span>
    <span>更新 <strong>${escapeHtml(relativeTime(room.latestActivityAt))}</strong></span>
  `;
}

function renderTags() {
  const tags = state.payload.room.topTags || [];

  if (!tags.length) {
    elements.roomTags.innerHTML = "";
    return;
  }

  elements.roomTags.innerHTML = [
    state.activeTag
      ? `<button class="tag-button" type="button" data-tag-clear="true">全て</button>`
      : "",
    ...tags.map((item) => {
      const active = item.tag === state.activeTag ? " is-active" : "";
      return `
        <button class="tag-button${active}" type="button" data-tag="${escapeHtml(item.tag)}">
          #${escapeHtml(item.tag)}
          <span>${numberFormat.format(item.count)}</span>
        </button>
      `;
    }),
  ].join("");

  for (const button of elements.roomTags.querySelectorAll("[data-tag]")) {
    button.addEventListener("click", () => {
      state.activeTag = button.dataset.tag;
      renderTags();
      renderThreads();
    });
  }

  const clearButton = elements.roomTags.querySelector("[data-tag-clear]");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      state.activeTag = "";
      renderTags();
      renderThreads();
    });
  }
}

function renderThreads() {
  const list = filteredThreads();
  elements.roomResultSummary.textContent = `${numberFormat.format(list.length)}件`;
  elements.roomThreadList.innerHTML = renderThreadRows(list, state.payload.rooms, {
    emptyMessage: "スレがありません。",
  });
}

function bindEvents() {
  elements.roomSearchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderThreads();
  });

  elements.roomSortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderThreads();
  });

  elements.roomMegathreadToggle.addEventListener("click", () => {
    state.onlyMegathreads = !state.onlyMegathreads;
    elements.roomMegathreadToggle.setAttribute("aria-pressed", String(state.onlyMegathreads));
    elements.roomMegathreadToggle.classList.toggle("is-active", state.onlyMegathreads);
    renderThreads();
  });
}

async function initialize() {
  state.payload = await requestJson(`/api/rooms/${roomId}`);

  renderRoomTabs(elements.roomTabs, state.payload.rooms, roomId);
  renderHeader();
  renderTags();
  renderThreads();
  elements.roomNewThreadLink.href = `/new?room=${encodeURIComponent(roomId)}`;
  bindEvents();
}

initialize().catch((error) => {
  console.error(error);
  elements.roomTitle.textContent = "部屋が見つかりません";
  elements.roomMeta.innerHTML = "";
  elements.roomThreadList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
