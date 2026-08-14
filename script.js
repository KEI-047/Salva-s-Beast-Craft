// ---------------------------------------------------------------------------
// タイムゾーン変換ユーティリティ（Intl API のみで実装、外部ライブラリ不要）
// ---------------------------------------------------------------------------

function getOffsetMinutes(timeZone, utcMillis) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMillis));
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUTC - utcMillis) / 60000; // local = utc + offset(分)
}

// 「timeZone における壁時計時刻 y/m/d hh:mm」から UTC の Date を求める
function zonedTimeToUtc(y, m, d, hh, mm, timeZone) {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const offset = getOffsetMinutes(timeZone, guess);
    guess = Date.UTC(y, m - 1, d, hh, mm) - offset * 60000;
  }
  return new Date(guess);
}

function parseDateTimeLocalInput(value) {
  // "YYYY-MM-DDTHH:mm" 形式
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return { y, m, d, hh, mm };
}

function inputToUtcDate(value, timeZone) {
  const { y, m, d, hh, mm } = parseDateTimeLocalInput(value);
  return zonedTimeToUtc(y, m, d, hh, mm, timeZone);
}

function getZonedParts(utcDate, timeZone) {
  const dtf = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(utcDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

function formatDateKey(utcDate, timeZone) {
  const p = getZonedParts(utcDate, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatDateLabel(utcDate, timeZone) {
  const p = getZonedParts(utcDate, timeZone);
  return `${p.year}年${p.month}月${p.day}日（${p.weekday}）`;
}

function formatTimeLabel(utcDate, timeZone) {
  const p = getZonedParts(utcDate, timeZone);
  return `${p.hour}:${p.minute}`;
}

function formatOffsetLabel(timeZone, at = new Date()) {
  const offsetMin = getOffsetMinutes(timeZone, at.getTime());
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

// ---------------------------------------------------------------------------
// タイムゾーン一覧
// ---------------------------------------------------------------------------

const CURATED_TIMEZONES = [
  ["Asia/Tokyo", "日本（東京）"],
  ["Asia/Seoul", "韓国（ソウル）"],
  ["Asia/Shanghai", "中国（上海）"],
  ["Asia/Taipei", "台湾（台北）"],
  ["Asia/Hong_Kong", "香港"],
  ["Asia/Singapore", "シンガポール"],
  ["Asia/Bangkok", "タイ（バンコク）"],
  ["Asia/Ho_Chi_Minh", "ベトナム（ホーチミン）"],
  ["Asia/Manila", "フィリピン（マニラ）"],
  ["Asia/Kuala_Lumpur", "マレーシア（クアラルンプール）"],
  ["Asia/Jakarta", "インドネシア（ジャカルタ）"],
  ["Asia/Kolkata", "インド（デリー）"],
  ["Asia/Dubai", "UAE（ドバイ）"],
  ["Europe/London", "イギリス（ロンドン）"],
  ["Europe/Paris", "フランス（パリ）"],
  ["Europe/Rome", "イタリア（ローマ）"],
  ["Europe/Berlin", "ドイツ（ベルリン）"],
  ["Europe/Madrid", "スペイン（マドリード）"],
  ["Europe/Moscow", "ロシア（モスクワ）"],
  ["Australia/Sydney", "オーストラリア（シドニー）"],
  ["Pacific/Auckland", "ニュージーランド（オークランド）"],
  ["Pacific/Honolulu", "ハワイ（ホノルル）"],
  ["America/Los_Angeles", "アメリカ（ロサンゼルス）"],
  ["America/Denver", "アメリカ（デンバー）"],
  ["America/Chicago", "アメリカ（シカゴ）"],
  ["America/New_York", "アメリカ（ニューヨーク）"],
  ["America/Toronto", "カナダ（トロント）"],
  ["America/Vancouver", "カナダ（バンクーバー）"],
  ["UTC", "協定世界時（UTC）"],
];

function populateTimezoneInputs() {
  const homeSelect = document.getElementById("home-tz");
  homeSelect.innerHTML = "";
  for (const [tz, label] of CURATED_TIMEZONES) {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = `${label} (${tz})`;
    homeSelect.appendChild(opt);
  }
  homeSelect.value = state.homeTz;

  const dataList = document.getElementById("tz-list");
  dataList.innerHTML = "";
  let allZones = CURATED_TIMEZONES.map(([tz]) => tz);
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      allZones = Intl.supportedValuesOf("timeZone");
    } catch (e) {
      // フォールバック: curated list のまま
    }
  }
  for (const tz of allZones) {
    const opt = document.createElement("option");
    opt.value = tz;
    dataList.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// 状態管理
// ---------------------------------------------------------------------------

const STORAGE_KEY = "travel-itinerary-events";
const HOME_TZ_KEY = "travel-itinerary-home-tz";

const state = {
  homeTz: localStorage.getItem(HOME_TZ_KEY) || "Asia/Tokyo",
  basis: "local", // "local" | "home"
  events: loadEvents(),
  currentType: "activity",
};

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events));
}

function saveHomeTz() {
  localStorage.setItem(HOME_TZ_KEY, state.homeTz);
}

// ---------------------------------------------------------------------------
// イベント正規化: それぞれ startUtc / endUtc（表示・並び替え用）を持たせる
// ---------------------------------------------------------------------------

function normalizeEvent(ev) {
  if (ev.type === "flight") {
    return {
      ...ev,
      sortUtc: ev.depUtc,
      primaryTz: ev.depTz,
    };
  }
  return {
    ...ev,
    sortUtc: ev.startUtc,
    primaryTz: ev.tz,
  };
}

// ---------------------------------------------------------------------------
// レンダリング
// ---------------------------------------------------------------------------

function render() {
  renderTimeline();
  renderUpcomingAlert();
}

function renderTimeline() {
  const container = document.getElementById("timeline");
  const emptyState = document.getElementById("empty-state");
  container.querySelectorAll(".day-group").forEach((n) => n.remove());

  if (state.events.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  const normalized = state.events.map(normalizeEvent).sort((a, b) => a.sortUtc - b.sortUtc);

  const groupTz = state.basis === "home" ? state.homeTz : null; // null => イベントごとの現地tz

  const groups = new Map();
  for (const ev of normalized) {
    const tzForGrouping = groupTz || ev.primaryTz;
    const key = formatDateKey(new Date(ev.sortUtc), tzForGrouping);
    if (!groups.has(key)) groups.set(key, { label: formatDateLabel(new Date(ev.sortUtc), tzForGrouping), items: [] });
    groups.get(key).items.push(ev);
  }

  const sortedKeys = [...groups.keys()].sort();

  for (const key of sortedKeys) {
    const group = groups.get(key);
    const groupEl = document.createElement("div");
    groupEl.className = "day-group";

    const header = document.createElement("div");
    header.className = "day-group__header";
    header.textContent = group.label;
    groupEl.appendChild(header);

    for (const ev of group.items) {
      groupEl.appendChild(renderEventCard(ev));
    }
    container.appendChild(groupEl);
  }
}

function dayDiffBadge(baseUtc, baseTz, compareUtc, compareTz) {
  const baseKey = formatDateKey(new Date(baseUtc), baseTz);
  const compareKey = formatDateKey(new Date(compareUtc), compareTz);
  if (baseKey === compareKey) return null;
  const diffDays = Math.round(
    (new Date(compareKey).getTime() - new Date(baseKey).getTime()) / 86400000
  );
  if (diffDays === 0) return null;
  return diffDays > 0 ? `+${diffDays}日` : `${diffDays}日`;
}

function renderEventCard(ev) {
  const card = document.createElement("div");
  card.className = "event-card" + (ev.type === "flight" ? " is-flight" : "");

  const main = document.createElement("div");
  main.className = "event-card__main";

  const titleRow = document.createElement("div");
  titleRow.className = "event-card__title-row";
  const title = document.createElement("span");
  title.className = "event-card__title";
  title.textContent = ev.title;
  titleRow.appendChild(title);

  const typeBadge = document.createElement("span");
  typeBadge.className = "badge" + (ev.type === "flight" ? " badge--flight" : "");
  typeBadge.textContent = ev.type === "flight" ? "✈️ フライト" : "📍 アクティビティ";
  titleRow.appendChild(typeBadge);

  main.appendChild(titleRow);

  if (ev.type === "flight") {
    main.appendChild(renderFlightLeg("出発", ev.depName, ev.depUtc, ev.depTz));
    const arrowRow = document.createElement("div");
    arrowRow.className = "flight-leg__arrow";
    arrowRow.textContent = "↓";
    main.appendChild(arrowRow);
    main.appendChild(renderFlightLeg("到着", ev.arrName, ev.arrUtc, ev.arrTz));

    const diffBadge = dayDiffBadge(ev.depUtc, ev.depTz, ev.arrUtc, ev.arrTz);
    if (diffBadge) {
      const b = document.createElement("span");
      b.className = "badge badge--daydiff";
      b.textContent = `到着地では ${diffBadge}`;
      main.appendChild(b);
    }

    main.appendChild(renderHomeTimeBlock(ev.depUtc, "出発（基準TZ）"));
  } else {
    const block = document.createElement("div");
    block.className = "time-block";
    block.appendChild(timeItem("現地時間", ev.startUtc, ev.tz, ev.endUtc));
    block.appendChild(timeItem(homeLabel(), ev.startUtc, state.homeTz, ev.endUtc));
    main.appendChild(block);

    const diffBadge = dayDiffBadge(ev.startUtc, ev.tz, ev.startUtc, state.homeTz);
    if (diffBadge) {
      const b = document.createElement("span");
      b.className = "badge badge--daydiff";
      b.textContent = `基準地では ${diffBadge}`;
      main.appendChild(b);
    }
  }

  if (ev.notes) {
    const notes = document.createElement("p");
    notes.className = "event-card__notes";
    notes.textContent = ev.notes;
    main.appendChild(notes);
  }

  card.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "event-card__actions";
  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn";
  delBtn.setAttribute("aria-label", "削除");
  delBtn.textContent = "🗑";
  delBtn.addEventListener("click", () => {
    state.events = state.events.filter((e) => e.id !== ev.id);
    saveEvents();
    render();
  });
  actions.appendChild(delBtn);
  card.appendChild(actions);

  return card;
}

function homeLabel() {
  const cityLabel = (CURATED_TIMEZONES.find(([tz]) => tz === state.homeTz) || [])[1];
  return cityLabel ? `基準時間（${cityLabel}）` : "基準時間";
}

function timeItem(label, startUtc, tz, endUtc) {
  const item = document.createElement("div");
  item.className = "time-block__item";
  const l = document.createElement("div");
  l.className = "time-block__label";
  l.textContent = `${label} · ${formatOffsetLabel(tz, new Date(startUtc))}`;
  const v = document.createElement("div");
  v.className = "time-block__value";
  let text = `${formatDateLabel(new Date(startUtc), tz)} ${formatTimeLabel(new Date(startUtc), tz)}`;
  if (endUtc) {
    text += ` 〜 ${formatTimeLabel(new Date(endUtc), tz)}`;
  }
  v.textContent = text;
  item.appendChild(l);
  item.appendChild(v);
  return item;
}

function renderFlightLeg(label, name, utcMillis, tz) {
  const row = document.createElement("div");
  row.className = "flight-leg";
  const l = document.createElement("span");
  l.className = "time-block__label";
  l.textContent = `${label}${name ? "：" + name : ""}`;
  const v = document.createElement("span");
  v.className = "time-block__value";
  v.textContent = `${formatDateLabel(new Date(utcMillis), tz)} ${formatTimeLabel(new Date(utcMillis), tz)} (${formatOffsetLabel(tz, new Date(utcMillis))})`;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

function renderHomeTimeBlock(utcMillis, label) {
  const block = document.createElement("div");
  block.className = "time-block";
  block.appendChild(timeItem(homeLabel(), utcMillis, state.homeTz, null));
  return block;
}

// ---------------------------------------------------------------------------
// アラート／通知
// ---------------------------------------------------------------------------

const ALERT_WINDOW_MIN = 60;
const notifiedIds = new Set();

function renderUpcomingAlert() {
  const banner = document.getElementById("alert-banner");
  const now = Date.now();
  const normalized = state.events.map(normalizeEvent);
  const upcoming = normalized
    .filter((ev) => ev.sortUtc - now > 0 && ev.sortUtc - now <= ALERT_WINDOW_MIN * 60000)
    .sort((a, b) => a.sortUtc - b.sortUtc)[0];

  if (!upcoming) {
    banner.classList.add("hidden");
    return;
  }

  const minutesLeft = Math.round((upcoming.sortUtc - now) / 60000);
  banner.classList.remove("hidden");
  banner.textContent = `⏰ まもなく: 「${upcoming.title}」まであと約${minutesLeft}分（現地 ${formatTimeLabel(
    new Date(upcoming.sortUtc),
    upcoming.primaryTz
  )} / 基準 ${formatTimeLabel(new Date(upcoming.sortUtc), state.homeTz)}）`;

  if (Notification.permission === "granted" && !notifiedIds.has(upcoming.id)) {
    notifiedIds.add(upcoming.id);
    new Notification("旅程リマインダー", {
      body: `「${upcoming.title}」まであと約${minutesLeft}分です。`,
    });
  }
}

document.getElementById("notify-btn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    document.getElementById("notify-status").textContent = "このブラウザは通知に対応していません";
    return;
  }
  const permission = await Notification.requestPermission();
  const statusEl = document.getElementById("notify-status");
  statusEl.textContent = permission === "granted" ? "通知が有効です" : "通知は許可されませんでした";
});

setInterval(renderUpcomingAlert, 30000);

// ---------------------------------------------------------------------------
// フォーム制御
// ---------------------------------------------------------------------------

const form = document.getElementById("event-form");
const toggleFormBtn = document.getElementById("toggle-form-btn");
const cancelFormBtn = document.getElementById("cancel-form-btn");

toggleFormBtn.addEventListener("click", () => {
  form.classList.toggle("hidden");
});
cancelFormBtn.addEventListener("click", () => {
  form.reset();
  form.classList.add("hidden");
});

document.querySelectorAll("#event-form .segmented[aria-label='予定の種別'] .segmented__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#event-form .segmented[aria-label='予定の種別'] .segmented__btn")
      .forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.currentType = btn.dataset.type;
    document.getElementById("fields-activity").classList.toggle("hidden", state.currentType !== "activity");
    document.getElementById("fields-flight").classList.toggle("hidden", state.currentType !== "flight");
  });
});

document.querySelectorAll(".controls-bar .segmented[role='radiogroup'] .segmented__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".controls-bar .segmented .segmented__btn")
      .forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.basis = btn.dataset.basis;
    render();
  });
});

document.getElementById("home-tz").addEventListener("change", (e) => {
  state.homeTz = e.target.value;
  saveHomeTz();
  render();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = document.getElementById("ev-title").value.trim();
  const notes = document.getElementById("ev-notes").value.trim();
  if (!title) return;

  if (state.currentType === "flight") {
    const depName = document.getElementById("dep-name").value.trim();
    const depTz = document.getElementById("dep-tz").value.trim();
    const depTime = document.getElementById("dep-time").value;
    const arrName = document.getElementById("arr-name").value.trim();
    const arrTz = document.getElementById("arr-tz").value.trim();
    const arrTime = document.getElementById("arr-time").value;

    if (!depTz || !depTime || !arrTz || !arrTime) {
      alert("出発・到着のタイムゾーンと日時を入力してください。");
      return;
    }
    if (!isValidTimeZone(depTz) || !isValidTimeZone(arrTz)) {
      alert("タイムゾーンの形式が正しくありません（例: Asia/Tokyo）。");
      return;
    }

    const depUtc = inputToUtcDate(depTime, depTz).getTime();
    const arrUtc = inputToUtcDate(arrTime, arrTz).getTime();

    state.events.push({
      id: crypto.randomUUID(),
      type: "flight",
      title,
      depName,
      depTz,
      depUtc,
      arrName,
      arrTz,
      arrUtc,
      notes,
    });
  } else {
    const tz = document.getElementById("act-tz").value.trim();
    const startVal = document.getElementById("act-start").value;
    const endVal = document.getElementById("act-end").value;

    if (!tz || !startVal) {
      alert("タイムゾーンと開始日時を入力してください。");
      return;
    }
    if (!isValidTimeZone(tz)) {
      alert("タイムゾーンの形式が正しくありません（例: Asia/Bangkok）。");
      return;
    }

    const startUtc = inputToUtcDate(startVal, tz).getTime();
    const endUtc = endVal ? inputToUtcDate(endVal, tz).getTime() : null;

    state.events.push({
      id: crypto.randomUUID(),
      type: "activity",
      title,
      tz,
      startUtc,
      endUtc,
      notes,
    });
  }

  saveEvents();
  form.reset();
  form.classList.add("hidden");
  render();
});

function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

populateTimezoneInputs();
render();
