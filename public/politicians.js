const {
  escapeHtml,
  requestJson,
  numberFormat,
  renderRoomTabs,
} = window.BoardShared;

const state = {
  politicians: [],
  query: "",
};

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  politicianSearch: document.getElementById("politicianSearch"),
  politicianCount: document.getElementById("politicianCount"),
  politicianGrid: document.getElementById("politicianGrid"),
};

function filteredPoliticians() {
  const query = state.query.trim().toLowerCase();
  if (!query) {
    return state.politicians;
  }

  return state.politicians.filter((politician) =>
    [
      politician.name,
      politician.nameKana,
      politician.group,
      politician.groupShort,
      politician.district,
      politician.chamber,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function renderPoliticians() {
  const politicians = filteredPoliticians();
  elements.politicianCount.textContent = `${numberFormat.format(politicians.length)}人`;

  if (!politicians.length) {
    elements.politicianGrid.innerHTML = `<p class="empty-state">該当する議員はいません。</p>`;
    return;
  }

  elements.politicianGrid.innerHTML = politicians
    .map(
      (politician) => `
        <article class="politician-card">
          <a class="politician-card-main" href="/politician/${politician.id}">
            <span class="politician-avatar politician-avatar-large" aria-hidden="true">${escapeHtml(
              politician.name.replace(/\s/g, "").slice(0, 1)
            )}</span>
            <span class="politician-card-copy">
              <span class="badge">${escapeHtml(politician.chamber)}</span>
              <strong>${escapeHtml(politician.name)}</strong>
              <span>${escapeHtml(politician.nameKana)}</span>
            </span>
          </a>
          <dl class="politician-facts">
            <div><dt>会派</dt><dd>${escapeHtml(politician.group)}</dd></div>
            <div><dt>選挙区</dt><dd>${escapeHtml(politician.district)}</dd></div>
          </dl>
          <div class="politician-card-stats">
            <span><strong>${numberFormat.format(politician.threadCount)}</strong> スレ</span>
            <span><strong>${numberFormat.format(politician.commentCount)}</strong> レス</span>
            <span><strong>${numberFormat.format(politician.reactionCount)}</strong> 反応</span>
          </div>
        </article>
      `
    )
    .join("");
}

async function initialize() {
  const payload = await requestJson("/api/politicians");
  state.politicians = payload.politicians || [];
  renderRoomTabs(elements.roomTabs, payload.rooms, null);
  elements.politicianSearch.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderPoliticians();
  });
  renderPoliticians();
}

initialize().catch((error) => {
  console.error(error);
  elements.politicianGrid.innerHTML = `<p class="empty-state">読込失敗: ${escapeHtml(error.message)}</p>`;
});
