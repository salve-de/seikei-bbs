const {
  escapeHtml,
  requestJson,
  renderRoomTabs,
  numberFormat,
  relativeTime,
  roomLabel,
  setFeedback,
  parseCooldown,
} = window.BoardShared;

const params = new URLSearchParams(window.location.search);
const topicId = params.get("id") || "";
const topic = (window.TopicDefinitions || []).find((item) => item.id === topicId);
const state = { board: null };

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  topicProfile: document.getElementById("topicProfile"),
  topicBoardTitle: document.getElementById("topicBoardTitle"),
  topicBoardMeta: document.getElementById("topicBoardMeta"),
  topicThreadCount: document.getElementById("topicThreadCount"),
  topicThreads: document.getElementById("topicThreads"),
  topicQuickForm: document.getElementById("topicQuickForm"),
  topicQuickBody: document.getElementById("topicQuickBody"),
  topicQuickSource: document.getElementById("topicQuickSource"),
  topicQuickFeedback: document.getElementById("topicQuickFeedback"),
  topicQuickSubmit: document.getElementById("topicQuickSubmit"),
  topicNewThread: document.getElementById("topicNewThread"),
};

function relatedThreads(threads) {
  return threads
    .filter((thread) =>
      thread.target?.id === topic.id ||
      thread.target?.label === topic.targetLabel ||
      (thread.tags || []).includes(topic.name)
    )
    .sort((left, right) => Number(right.heat || 0) - Number(left.heat || 0));
}

function renderProfile() {
  document.title = `${topic.name} | 政経板`;
  elements.topicBoardTitle.textContent = `${topic.name} 掲示板`;
  elements.topicBoardMeta.textContent = topic.category;
  elements.topicProfile.innerHTML = `
    <div>
      <div class="inline-row"><span class="badge">${escapeHtml(topic.category)}</span></div>
      <h1>${escapeHtml(topic.name)}</h1>
      <p>${escapeHtml(topic.description)}</p>
    </div>
    <div class="profile-actions">
      ${topic.sourceUrl ? `<a class="button button-muted" href="${escapeHtml(topic.sourceUrl)}" target="_blank" rel="noreferrer">関連情報</a>` : ""}
    </div>
  `;
  elements.topicNewThread.href = `/new?room=${encodeURIComponent(topic.room)}&targetType=${encodeURIComponent(topic.targetType)}&targetLabel=${encodeURIComponent(topic.targetLabel)}`;
}

function renderThreads(threads) {
  if (!threads.length) return '<p class="empty-state">まだ投稿がありません。</p>';
  return threads.map((thread) => `<a class="conversation-row" href="/thread/${thread.id}"><div class="conversation-row-main"><div class="inline-row"><span class="badge">${escapeHtml(roomLabel(state.board.rooms, thread.room))}</span></div><strong>${escapeHtml(thread.title)}</strong><p>${escapeHtml(thread.latestExcerpt || thread.summary)}</p></div><div class="conversation-row-stats"><span><strong>${numberFormat.format(thread.heat || 0)}</strong>勢い</span><span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span><span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span><small>${relativeTime(thread.lastActivityAt)}</small></div></a>`).join("");
}

function deriveTitle(body) {
  const normalized = String(body || "").replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/[。！？!?]/)[0].trim();
  const title = firstSentence.length >= 4 ? firstSentence : `${topic.name}について ${normalized}`;
  return title.slice(0, 120);
}

async function submitQuickPost(event) {
  event.preventDefault();
  setFeedback(elements.topicQuickFeedback, "");
  const body = elements.topicQuickBody.value.trim();
  if (body.length < 2) {
    setFeedback(elements.topicQuickFeedback, "本文を入力してください。");
    elements.topicQuickBody.focus();
    return;
  }

  elements.topicQuickSubmit.disabled = true;
  elements.topicQuickSubmit.textContent = "投稿中…";
  try {
    const sourceUrl = elements.topicQuickSource.value.trim();
    const response = await requestJson("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        room: topic.room,
        author: "",
        mode: "mixed",
        title: deriveTitle(body),
        summary: "",
        decisionPrompt: "",
        impactAreas: [],
        body,
        tags: [topic.name],
        sourceUrl,
        sourceKind: sourceUrl ? "other" : "",
        targetType: topic.targetType,
        targetId: "",
        targetLabel: topic.targetLabel,
        megathread: false,
      }),
    });
    window.location.href = `/thread/${response.thread.id}`;
  } catch (error) {
    setFeedback(elements.topicQuickFeedback, parseCooldown(error));
    elements.topicQuickSubmit.disabled = false;
    elements.topicQuickSubmit.textContent = "投稿する";
  }
}

async function initialize() {
  if (!topic) throw new Error("テーマが見つかりません。");
  state.board = await requestJson("/api/board");
  renderRoomTabs(elements.roomTabs, state.board.rooms, topic.room);
  renderProfile();
  const threads = relatedThreads(state.board.threads || []);
  elements.topicThreadCount.textContent = `${numberFormat.format(threads.length)}件`;
  elements.topicThreads.innerHTML = renderThreads(threads);
  elements.topicQuickForm.addEventListener("submit", submitQuickPost);
}

initialize().catch((error) => {
  console.error(error);
  elements.topicProfile.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
