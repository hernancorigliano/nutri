const score = window.NutriScore;
const github = window.NutriGitHub;

const root = document.querySelector("#app");
const state = {
  screen: "connect",
  session: null,
  days: {},
  photoUrls: {},
  photoErrors: {},
  photoBusy: {},
  viewDate: null,
  sheetFrom: "home",
  sheetMeal: "breakfast",
  drafts: null,
  busy: false,
  error: "",
  loaded: false,
  loadError: "",
  repoField: null,
};
let paintedScreen = "";

root.addEventListener("click", onClick);
root.addEventListener("change", onPhotoPicked);
root.addEventListener("submit", onConnect);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.screen === "sheet" && !state.busy) closeSheet();
});

init();

async function init() {
  state.session = github.loadSession();
  if (!state.session) {
    paint();
    return;
  }
  state.screen = "home";
  paint();
  await refresh();
}

async function refresh() {
  state.busy = true;
  state.loadError = "";
  paint();
  try {
    state.days = score.normalizeLog(await github.loadDays(state.session));
    state.loaded = true;
  } catch (error) {
    state.loaded = false;
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      state.error = github.friendlyError(error);
      state.screen = "connect";
    } else {
      state.loadError = github.friendlyError(error);
    }
  } finally {
    state.busy = false;
    paint();
  }
}

function paint() {
  const keepScroll = paintedScreen === state.screen;
  const current = document.querySelector(state.screen === "sheet" ? ".sheet" : ".scroller");
  const top = keepScroll && current ? current.scrollTop : 0;
  root.innerHTML = render();
  paintedScreen = state.screen;
  const next = document.querySelector(state.screen === "sheet" ? ".sheet" : ".scroller");
  if (keepScroll && next) next.scrollTop = top;
  queuePhotos();
}

function render() {
  if (state.screen === "connect") return renderConnect();
  if (state.screen === "day") return renderDay();
  if (state.screen === "sheet") return `${renderDay()}${renderSheet()}`;
  return renderHome();
}

function renderConnect() {
  const session = state.session;
  const repo = state.repoField ?? (session ? `${session.owner}/${session.repo}` : "");
  return `
    <section class="connect app">
      <h1>Nutri</h1>
      <p class="lead">A private log for three meals and your 10,000-step goal. The app shell is public. Photos and scores stay in the repo you name here.</p>
      ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
      <form id="connect-form">
        <label for="repo">Private data repo</label>
        <input id="repo" name="repo" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://github.com/you/nutri-data" value="${esc(repo)}" required>
        <label for="token">Access token</label>
        <input id="token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${session ? "Leave blank to keep the saved token" : "github_pat_..."}" ${session ? "" : "required"}>
        <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Checking…" : "Open my log"}</button>
      </form>
      ${session ? `<button class="ghost" type="button" data-action="forget" ${state.busy ? "disabled" : ""}>Forget token</button>` : ""}
      <p class="help">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">fine-grained token</a> with Contents read and write on that private repo only. It stays in this browser.</p>
    </section>
  `;
}

function renderHome() {
  const today = new Date();
  const currentWeek = score.startOfWeek(today);
  const thisScore = score.weekScore(state.days, currentWeek);
  const lastScore = score.weekScore(state.days, score.addDays(currentWeek, -7));
  const todayScore = score.dayScore(state.days[score.isoDate(today)]);
  const reachable = score.stillReachable(todayScore, today);
  const weeks = state.loaded ? score.weeksToShow(state.days, today) : [];
  return `
    <div class="app">
      ${topbar("Nutri", connectionButton(), plusButton())}
      <main class="scroller">
        ${state.loadError ? `<p class="error banner" role="alert">${esc(state.loadError)}</p><button class="primary" type="button" data-action="retry">Try again</button>` : ""}
        <section class="card summary">
          <p class="eyebrow">This week</p>
          <p class="eyebrow right">Last week</p>
          <p class="this-score">${thisScore}<span> /70</span></p>
          <p class="last-score">${lastScore}</p>
          <div class="bar" aria-hidden="true"><span style="width:${Math.min(100, (thisScore / 70) * 100)}%"></span></div>
          <div class="summary-foot">
            <span>${esc(score.beatLabel(thisScore, lastScore))}</span>
            <span>Still reachable: ${reachable}</span>
          </div>
        </section>
        <div class="legend">
          <span><i class="swatch"></i> Day score</span>
          <span>${footIcon()} 10k</span>
          <span class="dots"><i class="dot good"></i><i class="dot okay"></i><i class="dot bad"></i></span>
          <span>B · L · D</span>
        </div>
        ${state.loaded ? weeks.map((week, index) => renderWeek(week, index, weeks, today)).join("") : `<p class="loading">${state.busy ? "Loading your log…" : ""}</p>`}
      </main>
    </div>
  `;
}

function renderWeek(weekStart, index, weeks, today) {
  const total = score.weekScore(state.days, weekStart);
  const current = score.isoDate(weekStart) === score.isoDate(score.startOfWeek(today));
  let delta = "";
  if (index < weeks.length - 1) {
    const previous = score.weekScore(state.days, weeks[index + 1]);
    delta = deltaMarkup(total - previous);
  }
  const days = Array.from({ length: 7 }, (_, offset) => score.addDays(weekStart, offset));
  return `
    <section class="card week">
      <div class="week-head">
        <div class="week-title">
          <span>${esc(score.formatWeekLabel(weekStart))}</span>
          ${current ? `<span class="pill">This week</span>` : ""}
        </div>
        <div class="week-meta">${delta}<span class="total"><b>${total}</b>/70</span></div>
      </div>
      <div class="days">
        ${days.map((date) => renderDayCell(date, today)).join("")}
      </div>
    </section>
  `;
}

function renderDayCell(date, today) {
  const iso = score.isoDate(date);
  const day = state.days[iso];
  const band = score.dayBand(day);
  const todayClass = iso === score.isoDate(today) ? " today" : "";
  return `
    <button class="day ${band}${todayClass}" type="button" data-action="open-day" data-date="${iso}" aria-label="${esc(score.formatDayTitle(date, today))}">
      <span class="dow">${score.weekdayShort(date)}</span>
      <span class="foot ${day?.steps ? "" : "off"}">${footIcon()}</span>
      <span class="dots">
        ${score.MEALS.map((meal) => `<i class="dot ${day?.meals?.[meal]?.status || "empty"}"></i>`).join("")}
      </span>
    </button>
  `;
}

function renderDay() {
  const date = score.parseISO(state.viewDate);
  const day = score.normalizeDay(state.days[state.viewDate]);
  const reached = Boolean(state.days[state.viewDate]?.steps);
  return `
    <div class="app">
      ${topbar(score.formatDayTitle(date), backButton(), `<span></span>`)}
      <main class="scroller">
        ${state.error && state.screen === "day" ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
        <section class="card steps">
          <div class="steps-label">${walkIcon()} 10,000 steps</div>
          <div class="steps-status ${reached ? "" : "off"}">${reached ? "Reached" : "Not reached"}</div>
          <p class="muted">${reached ? "The 10,000-step goal is done for this day." : "Mark this once you pass 10,000 steps."}</p>
          <button class="primary" type="button" data-action="toggle-steps" ${state.busy ? "disabled" : ""}>${state.busy ? "Saving…" : reached ? "Mark goal not reached" : "Mark goal reached"}</button>
        </section>
        <section class="card score-row">
          <span>Day score</span>
          <strong>${score.dayScore(day)} / 10</strong>
        </section>
        <div class="stack">
          ${score.MEALS.map((meal) => renderMealCard(meal, day.meals[meal])).join("")}
        </div>
      </main>
    </div>
  `;
}

function photoMessage(entry) {
  if (entry.photo && state.photoErrors[entry.photo]) return "Photo unavailable";
  if (entry.photo) return "Loading photo…";
  if (entry.status) return "No photo";
  return "Tap to log this meal";
}

function renderMealCard(meal, entry) {
  const src = entry.photo ? safePhotoUrl(state.photoUrls[entry.photo]) : "";
  const photo = src
    ? `<div class="photo"><img src="${src}" alt="${esc(score.mealLabel(meal))} photo"></div>`
    : `<div class="photo"><div class="placeholder">${imageIcon()}<span>${photoMessage(entry)}</span></div></div>`;
  return `
    <button class="meal-card" type="button" data-action="open-meal" data-meal="${meal}" ${state.busy ? "disabled" : ""}>
      <div class="meal-head">
        <div class="meal-name">${mealIcon(meal)} <span>${score.mealLabel(meal)}</span></div>
        <span class="status-pill ${entry.status || "none"}">${score.statusLabel(entry.status)}</span>
      </div>
      ${photo}
    </button>
  `;
}

function renderSheet() {
  const date = score.parseISO(state.viewDate);
  const meal = state.sheetMeal;
  const draft = state.drafts[meal];
  const src = safePhotoUrl(draft.previewUrl) || (draft.photoPath ? safePhotoUrl(state.photoUrls[draft.photoPath]) : "");
  const photo = src
    ? `<img src="${src}" alt="${esc(score.mealLabel(meal))} photo">`
    : `<div class="placeholder">${imageIcon(true)}<span>${draft.photoPath && !draft.previewUrl && !state.photoErrors[draft.photoPath] ? "Loading photo…" : draft.photoPath && state.photoErrors[draft.photoPath] ? "Photo unavailable" : `Add a ${meal} photo from your gallery`}</span></div>`;
  return `
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Log a meal">
      <div class="sheet-bar">
        <button class="text-btn" type="button" data-action="close-sheet" ${state.busy ? "disabled" : ""}>Cancel</button>
        <h2>${esc(score.formatSheetTitle(date))}</h2>
        <button class="text-btn save" type="button" data-action="save-sheet" ${state.busy ? "disabled" : ""}>${state.busy ? "Saving…" : "Save"}</button>
      </div>
      <div class="segments">
        ${score.MEALS.map((name) => `<button type="button" data-action="pick-meal" data-meal="${name}" class="${name === meal ? "active" : ""}">${score.mealLabel(name)}</button>`).join("")}
      </div>
      <div class="sheet-dots">
        ${score.MEALS.map((name) => `<span><i class="dot ${state.drafts[name].status || "empty"}"></i> ${name[0].toUpperCase()}</span>`).join("")}
      </div>
      <div class="sheet-body">
        ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
        <button class="photo-pick" type="button" data-action="pick-photo" ${state.busy ? "disabled" : ""}>${photo}</button>
        <input class="file" id="photo-input" type="file" accept="image/*">
        <h3>How was it?</h3>
        <div class="choices">
          ${["good", "okay", "bad"].map((status) => `
            <button class="choice ${status} ${draft.status === status ? "selected" : ""}" type="button" data-action="pick-status" data-status="${status}">
              <span class="choice-orb">${draft.status === status ? checkIcon() : ""}</span>
              ${score.statusLabel(status)}
            </button>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function topbar(title, left, right) {
  return `<header class="topbar"><div>${left}</div><h1>${esc(title)}</h1><div>${right}</div></header>`;
}

function connectionButton() {
  return `<button class="icon-btn" type="button" data-action="connection" aria-label="Data connection">${linkIcon()}</button>`;
}

function plusButton() {
  return `<button class="icon-btn" type="button" data-action="log-today" aria-label="Log today" ${state.loaded && !state.busy ? "" : "disabled"}>${plusIcon()}</button>`;
}

function backButton() {
  return `<button class="icon-btn" type="button" data-action="back" aria-label="Back">${chevronIcon()}</button>`;
}

function deltaMarkup(delta) {
  if (delta > 0) return `<span class="delta up">${arrowIcon("up")} +${delta}</span>`;
  if (delta < 0) return `<span class="delta down">${arrowIcon("down")} ${delta}</span>`;
  return `<span class="delta flat">${delta}</span>`;
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (state.busy && action !== "close-sheet") return;
  if (action === "connection") {
    state.error = "";
    state.repoField = null;
    state.screen = "connect";
    paint();
  } else if (action === "forget") {
    forget();
  } else if (action === "retry") {
    await refresh();
  } else if (action === "log-today") {
    openSheet(score.isoDate(new Date()), "home");
  } else if (action === "open-day") {
    state.viewDate = button.dataset.date;
    state.error = "";
    state.screen = "day";
    paint();
  } else if (action === "back") {
    state.error = "";
    state.screen = "home";
    paint();
  } else if (action === "open-meal") {
    openSheet(state.viewDate, "day", button.dataset.meal);
  } else if (action === "close-sheet") {
    closeSheet();
  } else if (action === "pick-meal") {
    state.sheetMeal = button.dataset.meal;
    state.error = "";
    paint();
  } else if (action === "pick-status") {
    state.drafts[state.sheetMeal].status = button.dataset.status;
    paint();
  } else if (action === "pick-photo") {
    document.querySelector("#photo-input")?.click();
  } else if (action === "toggle-steps") {
    await toggleSteps();
  } else if (action === "save-sheet") {
    await saveSheet();
  }
}

async function onConnect(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "connect-form") return;
  event.preventDefault();
  if (state.busy) return;
  const data = new FormData(form);
  const repo = String(data.get("repo") || "");
  state.repoField = repo;
  let token = String(data.get("token") || "").trim();
  if (!token && state.session && repoMatches(repo, state.session)) token = state.session.token;
  state.busy = true;
  state.error = "";
  paint();
  try {
    state.session = await github.connectRepo(repo, token);
    state.screen = "home";
    state.loaded = false;
    state.days = {};
    clearPhotos();
    state.busy = false;
    await refresh();
  } catch (error) {
    state.busy = false;
    state.error = error.status ? github.friendlyError(error) : error.message;
    state.screen = "connect";
    paint();
  }
}

function onPhotoPicked(event) {
  if (event.target.id !== "photo-input" || !state.drafts) return;
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const draft = state.drafts[state.sheetMeal];
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  draft.file = file;
  draft.previewUrl = URL.createObjectURL(file);
  paint();
}

function openSheet(date, from, meal = "breakfast") {
  state.viewDate = date;
  state.sheetFrom = from;
  state.sheetMeal = meal;
  state.drafts = makeDrafts(date);
  state.error = "";
  state.screen = "sheet";
  paint();
}

function closeSheet() {
  if (state.drafts) {
    for (const meal of score.MEALS) {
      if (state.drafts[meal].previewUrl) URL.revokeObjectURL(state.drafts[meal].previewUrl);
    }
  }
  state.drafts = null;
  state.error = "";
  state.screen = state.sheetFrom === "day" ? "day" : "home";
  paint();
}

function makeDrafts(date) {
  const day = score.normalizeDay(state.days[date]);
  const drafts = {};
  for (const meal of score.MEALS) {
    drafts[meal] = {
      status: day.meals[meal].status,
      photoPath: day.meals[meal].photo,
      file: null,
      previewUrl: null,
    };
  }
  return drafts;
}

async function toggleSteps() {
  const date = state.viewDate;
  const nextDay = score.normalizeDay(state.days[date]);
  nextDay.steps = !nextDay.steps;
  const days = { ...state.days };
  if (score.isLogged(nextDay)) days[date] = nextDay;
  else delete days[date];
  state.busy = true;
  state.error = "";
  paint();
  try {
    await github.saveChanges(state.session, {
      days: score.normalizeLog(days),
      photos: [],
      message: `Update steps for ${date}`,
    });
    state.days = score.normalizeLog(days);
  } catch (error) {
    state.error = github.friendlyError(error);
  } finally {
    state.busy = false;
    paint();
  }
}

async function saveSheet() {
  const date = state.viewDate;
  const current = score.normalizeDay(state.days[date]);
  for (const meal of score.MEALS) {
    if (state.drafts[meal].file && !state.drafts[meal].status) {
      state.error = "Choose how that meal was before saving the photo.";
      paint();
      return;
    }
  }
  state.busy = true;
  state.error = "";
  paint();
  try {
    const nextDay = score.normalizeDay(current);
    const photos = [];
    let changed = false;
    for (const meal of score.MEALS) {
      const draft = state.drafts[meal];
      let photo = draft.photoPath;
      if (draft.file) {
        const base64 = await compressImage(draft.file);
        photo = `photos/${date}-${meal}.jpg`;
        photos.push({ path: photo, base64 });
        changed = true;
      }
      if (draft.status !== current.meals[meal].status || photo !== current.meals[meal].photo) changed = true;
      nextDay.meals[meal] = { status: draft.status, photo };
    }
    if (!changed) {
      state.busy = false;
      closeSheet();
      return;
    }
    const days = { ...state.days };
    if (score.isLogged(nextDay)) days[date] = nextDay;
    else delete days[date];
    const saved = score.normalizeLog(days);
    await github.saveChanges(state.session, {
      days: saved,
      photos,
      message: `Log meals for ${date}`,
    });
    state.days = saved;
    for (const photo of photos) rememberPhoto(photo.path, photo.base64);
    state.busy = false;
    closeSheet();
  } catch (error) {
    state.busy = false;
    state.error = error.status ? github.friendlyError(error) : error.message;
    paint();
  }
}

function forget() {
  github.clearSession();
  clearPhotos();
  state.session = null;
  state.days = {};
  state.loaded = false;
  state.error = "";
  state.screen = "connect";
  paint();
}

function clearPhotos() {
  for (const url of Object.values(state.photoUrls)) {
    if (url) URL.revokeObjectURL(url);
  }
  state.photoUrls = {};
  state.photoErrors = {};
  state.photoBusy = {};
}

function queuePhotos() {
  for (const path of visiblePhotoPaths()) ensurePhoto(path);
}

function visiblePhotoPaths() {
  const paths = [];
  if ((state.screen === "day" || state.screen === "sheet") && state.viewDate && state.days[state.viewDate]) {
    for (const meal of score.MEALS) {
      const path = state.days[state.viewDate].meals?.[meal]?.photo;
      if (path) paths.push(path);
    }
  }
  if (state.screen === "sheet" && state.drafts) {
    for (const meal of score.MEALS) {
      if (state.drafts[meal].photoPath && !state.drafts[meal].previewUrl) paths.push(state.drafts[meal].photoPath);
    }
  }
  return paths;
}

async function ensurePhoto(path) {
  if (!path || !state.session || state.photoBusy[path] || path in state.photoUrls || state.photoErrors[path]) return;
  state.photoBusy[path] = true;
  try {
    state.photoUrls[path] = await github.loadPhoto(state.session, path);
  } catch {
    state.photoErrors[path] = true;
  } finally {
    delete state.photoBusy[path];
    paint();
  }
}

function rememberPhoto(path, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (state.photoUrls[path]) URL.revokeObjectURL(state.photoUrls[path]);
  state.photoUrls[path] = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  delete state.photoErrors[path];
}

function repoMatches(input, session) {
  try {
    const parsed = github.parseRepo(input);
    return parsed.owner === session.owner && parsed.repo === session.repo;
  } catch {
    return false;
  }
}

async function compressImage(file) {
  const source = await loadImage(file);
  try {
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("Could not compress that photo.");
    return await blobToBase64(blob);
  } finally {
    if (source.close) source.close();
    if (source.src) URL.revokeObjectURL(source.src);
  }
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to an Image element for formats the bitmap decoder rejects.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not read that photo. Use a JPEG or PNG."));
      image.src = url;
    });
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(blob);
  });
}

function safePhotoUrl(url) {
  return typeof url === "string" && url.startsWith("blob:") ? url : "";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function footIcon() {
  return `<svg class="mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.2 3.6c.9 0 1.6.9 1.5 1.9-.2 1.6-1.1 2.4-2.1 2.4S5.6 7 5.8 5.4c.1-1 .7-1.8 1.6-1.8zm4.7.7c.7 0 1.3.7 1.2 1.5-.1 1-.7 1.6-1.4 1.6s-1.2-.7-1.1-1.6c.1-.8.6-1.5 1.3-1.5zM16.8 6c.6 0 1.1.6 1 1.3-.1.8-.6 1.3-1.2 1.3s-1-.6-.9-1.3c0-.7.5-1.3 1.1-1.3zM18.6 9.2c.6 0 1 .6.9 1.2-.2.8-.7 1.2-1.3 1.2s-.9-.6-.7-1.3c.1-.6.5-1.1 1.1-1.1zM9.4 9.2c1.7 0 2.6 1.4 2.3 3.2-.4 2.6-2.2 4.8-4.6 4.8-1.6 0-2.7-1.1-2.5-2.6.3-2.2 1.8-5.4 4.8-5.4z"/></svg>`;
}

function walkIcon() {
  return `<svg class="mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 5.5a2 2 0 1 1-1.6-2 2 2 0 0 1 1.6 2zM9.2 22l1.2-5.1-2.1-1.1 1.3-2.2 2.8 1.5 1.4-2.4-2.2-1.2.6-1.6 3.4 1.6c.5.2.8.8.7 1.3l-.7 3.2 2.2 1.1-.7 1.6-3.2-1.6L12 22H9.2zm5.3-9.6.8 3.2 2.2-1.2-.8-1.4-2.2-.6z"/></svg>`;
}

function linkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10 5.9"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M14 11a5 5 0 0 0-7.1-.1L5.5 12.3a5 5 0 0 0 7.1 7.1L14 18.1"/></svg>`;
}

function plusIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>`;
}

function chevronIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M15 5 8 12l7 7"/></svg>`;
}

function arrowIcon(direction) {
  const transform = direction === "down" ? ` transform="rotate(180 12 12)"` : "";
  return `<svg viewBox="0 0 24 24" aria-hidden="true"${transform}><path fill="currentColor" d="M12 5l6 7h-4v7h-4v-7H6z"/></svg>`;
}

function checkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 10 17l9-10"/></svg>`;
}

function imageIcon(withPlus = false) {
  const plus = withPlus
    ? `<circle cx="17.5" cy="17.5" r="4" fill="currentColor"/><path stroke="white" stroke-width="1.6" stroke-linecap="round" d="M17.5 15.7v3.6M15.7 17.5h3.6"/>`
    : "";
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.4" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="m7 16 3.2-3.2 2.2 2.2L16 11l3 3"/>${plus}</svg>`;
}

function mealIcon(meal) {
  if (meal === "breakfast") {
    return `<svg class="mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2v3M7 20h10M4.5 8H2M6 4.5 4.2 2.8M18 4.5 19.8 2.8M19.5 8H22"/></svg>`;
  }
  if (meal === "lunch") {
    return `<svg class="mini-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path fill="currentColor" d="M12 2h1.2v3H12zm0 17h1.2v3H12zM2 12h3v1.2H2zm17 0h3v1.2h-3zM4.4 4.4l.9-.9 2.1 2.1-.9.9zm12.2 12.2.9-.9 2.1 2.1-.9.9zm0-11.3 2.1-2.1.9.9-2.1 2.1zm-12.2 12.2 2.1-2.1.9.9-2.1 2.1z"/></svg>`;
  }
  return `<svg class="mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 3.2a8 8 0 1 0 5.8 13.5A7 7 0 0 1 15 3.2z"/></svg>`;
}
