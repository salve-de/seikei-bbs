const { escapeHtml, requestJson, renderRoomTabs, numberFormat } = window.BoardShared;

const topicDirectory = document.getElementById("topicDirectory");
const roomTabs = document.getElementById("roomTabs");

function relatedThreads(topic, threads) {
  return threads.filter((thread) =>
    thread.target?.id === topic.id ||
    thread.target?.label === topic.targetLabel ||
    (thread.tags || []).includes(topic.name)
  );
}

async function initialize() {
  const board = await requestJson("/api/board");
  renderRoomTabs(roomTabs, board.rooms, null);
  topicDirectory.innerHTML = (window.TopicDefinitions || []).map((topic) => {
    const threads = relatedThreads(topic, board.threads || []);
    const comments = threads.reduce((sum, thread) => sum + Number(thread.commentCount || 0), 0);
    return `<a class="topic-card" href="/topic.html?id=${encodeURIComponent(topic.id)}">
      <div class="inline-row"><span class="badge">${escapeHtml(topic.category)}</span></div>
      <strong>${escapeHtml(topic.name)}</strong>
      <p>${escapeHtml(topic.description)}</p>
      <span class="section-note">${numberFormat.format(threads.length)}スレ · ${numberFormat.format(comments)}レス</span>
    </a>`;
  }).join("");
}

initialize().catch((error) => {
  console.error(error);
  topicDirectory.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
