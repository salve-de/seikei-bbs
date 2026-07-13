const {
  escapeHtml,
  requestJson,
  numberFormat,
  formatDate,
  relativeTime,
  renderRoomTabs,
  roomLabel,
  setFeedback,
  parseCooldown,
} = window.BoardShared;

const politicianId = decodeURIComponent(window.location.pathname.split("/").pop() || "");
const state = { payload: null };

const elements = {
  roomTabs: document.getElementById("roomTabs"),
  politicianProfile: document.getElementById("politicianProfile"),
  politicianBoardTitle: document.getElementById("politicianBoardTitle"),
  politicianBoardMeta: document.getElementById("politicianBoardMeta"),
  politicianNewThread: document.getElementById("politicianNewThread"),
  politicianThreadCount: document.getElementById("politicianThreadCount"),
  politicianThreads: document.getElementById("politicianThreads"),
  politicianQuickForm: document.getElementById("politicianQuickForm"),
  politicianQuickBody: document.getElementById("politicianQuickBody"),
  politicianQuickRoom: document.getElementById("politicianQuickRoom"),
  politicianQuickSource: document.getElementById("politicianQuickSource"),
  politicianQuickFeedback: document.getElementById("politicianQuickFeedback"),
  politicianQuickSubmit: document.getElementById("politicianQuickSubmit"),
};

function optionalFact(label, value) {
  if (!value) return "";
  return `<span><small>${escapeHtml(label)}</small>${escapeHtml(value)}</span>`;
}

function renderProfile(politician) {
  document.title = `${politician.name} | 政経板`;
  elements.politicianBoardTitle.textContent = `${politician.name} 掲示板`;
  elements.politicianBoardMeta.textContent = `${politician.groupShort} · ${politician.district}`;
  elements.politicianNewThread.href = `/new?targetType=politician&targetId=${encodeURIComponent(politician.id)}`;

  const committees = (politician.committees || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const officialLinks = [
    politician.websiteUrl ? `<a class="button button-muted" href="${escapeHtml(politician.websiteUrl)}" target="_blank" rel="noreferrer">公式サイト</a>` : "",
    politician.sourceUrl ? `<a class="button button-muted" href="${escapeHtml(politician.sourceUrl)}" target="_blank" rel="noreferrer">公式プロフィール</a>` : "",
  ].filter(Boolean).join("");

  elements.politicianProfile.innerHTML = `
    <span class="politician-avatar profile-avatar" aria-hidden="true">${escapeHtml(politician.name.replace(/\s/g, "").slice(0, 1))}</span>
    <div class="profile-copy">
      <div class="inline-row">
        <span class="badge">${escapeHtml(politician.chamber)}</span>
        <span class="badge">${escapeHtml(politician.groupShort)}</span>
        ${politician.termCount ? `<span class="badge">${numberFormat.format(politician.termCount)}期</span>` : ""}
      </div>
      <h1>${escapeHtml(politician.name)}</h1>
      <p>${escapeHtml(politician.nameKana)}</p>
      <div class="profile-facts">
        ${optionalFact("会派", politician.group)}
        ${optionalFact("選挙区", politician.district)}
        ${optionalFact("生年月日", politician.birthDate ? formatDate(politician.birthDate) : "")}
        ${optionalFact("出身", politician.birthPlace)}
        ${optionalFact("学歴", politician.education)}
        ${optionalFact("経歴", politician.career)}
        ${optionalFact("役職", politician.role)}
        ${optionalFact("確認日", politician.verifiedAt ? formatDate(politician.verifiedAt) : "")}
      </div>
      ${committees ? `<div class="profile-committees"><strong>所属委員会</strong><ul>${committees}</ul></div>` : ""}
    </div>
    <div class="profile-actions">${officialLinks}</div>
  `;
}

function renderThreads(threads, rooms) {
  if (!threads.length) return '<p class="empty-state">まだ投稿がありません。</p>';
  return threads.map((thread) => `<a class="conversation-row" href="/thread/${thread.id}"><div class="conversation-row-main"><div class="inline-row"><span class="badge">${escapeHtml(roomLabel(rooms, thread.room))}</span>${thread.mode === "opposition-welcome" ? '<span class="badge badge-danger">反対歓迎</span>' : ""}</div><strong>${escapeHtml(thread.title)}</strong><p>${escapeHtml(thread.latestExcerpt || thread.summary)}</p></div><div class="conversation-row-stats"><span><strong>${numberFormat.format(thread.heat || 0)}</strong>勢い</span><span><strong>${numberFormat.format(thread.commentCount || 0)}</strong>レス</span><span><strong>${numberFormat.format(thread.participantCount || 0)}</strong>人</span><small>${relativeTime(thread.lastActivityAt)}</small></div></a>`).join("");
}

function populateRooms(rooms) {
  elements.politicianQuickRoom.innerHTML = rooms
    .map((room) => `<option value="${room.id}">${escapeHtml(room.label)}</option>`)
    .join("");
  if (rooms.some((room) => room.id === "election")) elements.politicianQuickRoom.value = "election";
}

function deriveTitle(body, politicianName) {
  const normalized = String(body || "").replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/[。！？!?]/)[0].trim();
  const title = firstSentence.length >= 4 ? firstSentence : `${politicianName}について ${normalized}`;
  return title.slice(0, 120);
}

async function submitQuickPost(event) {
  event.preventDefault();
  setFeedback(elements.politicianQuickFeedback, "");
  const body = elements.politicianQuickBody.value.trim();
  if (body.length < 2) {
    setFeedback(elements.politicianQuickFeedback, "本文を入力してください。");
    elements.politicianQuickBody.focus();
    return;
  }

  elements.politicianQuickSubmit.disabled = true;
  elements.politicianQuickSubmit.textContent = "投稿中…";
  try {
    const politician = state.payload.politician;
    const sourceUrl = elements.politicianQuickSource.value.trim();
    const response = await requestJson("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        room: elements.politicianQuickRoom.value,
        author: "",
        mode: "mixed",
        title: deriveTitle(body, politician.name),
        summary: "",
        decisionPrompt: "",
        impactAreas: [],
        body,
        tags: [politician.name],
        sourceUrl,
        sourceKind: sourceUrl ? "other" : "",
        targetType: "politician",
        targetId: politician.id,
        targetLabel: politician.name,
        megathread: false,
      }),
    });
    window.location.href = `/thread/${response.thread.id}`;
  } catch (error) {
    setFeedback(elements.politicianQuickFeedback, parseCooldown(error));
    elements.politicianQuickSubmit.disabled = false;
    elements.politicianQuickSubmit.textContent = "投稿する";
  }
}

async function initialize() {
  state.payload = await requestJson(`/api/politicians/${politicianId}`);
  renderRoomTabs(elements.roomTabs, state.payload.rooms, null);
  renderProfile(state.payload.politician);
  populateRooms(state.payload.rooms);
  elements.politicianThreadCount.textContent = `${numberFormat.format(state.payload.threads.length)}件`;
  elements.politicianThreads.innerHTML = renderThreads(state.payload.threads, state.payload.rooms);
  elements.politicianQuickForm.addEventListener("submit", submitQuickPost);
}

initialize().catch((error) => {
  console.error(error);
  elements.politicianProfile.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
