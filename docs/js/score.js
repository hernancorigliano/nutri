const MEALS = ["breakfast", "lunch", "dinner"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function mealPoints(status) {
  if (status === "good") return 3;
  if (status === "okay") return 2;
  if (status === "bad") return 1;
  return 0;
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + delta);
  return next;
}

function normalizeDay(day) {
  const meals = {};
  for (const meal of MEALS) {
    const entry = day?.meals?.[meal] || {};
    const status = entry.status === "good" || entry.status === "okay" || entry.status === "bad"
      ? entry.status
      : null;
    meals[meal] = {
      status,
      photo: typeof entry.photo === "string" && entry.photo ? entry.photo : null,
    };
  }
  return { steps: Boolean(day?.steps), meals };
}

function isLogged(day) {
  if (!day) return false;
  if (day.steps) return true;
  return MEALS.some((meal) => {
    const entry = day.meals?.[meal];
    return Boolean(entry && (entry.status || entry.photo));
  });
}

function dayScore(day) {
  if (!day) return 0;
  const meals = MEALS.reduce((total, meal) => total + mealPoints(day.meals?.[meal]?.status), 0);
  return meals + (day.steps ? 1 : 0);
}

function dayBand(day) {
  if (!isLogged(day)) return "empty";
  const score = dayScore(day);
  if (score <= 3) return "low";
  if (score <= 7) return "mid";
  return "high";
}

function normalizeLog(days) {
  const next = {};
  if (!days || typeof days !== "object" || Array.isArray(days)) return next;
  for (const key of Object.keys(days).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const day = normalizeDay(days[key]);
    if (isLogged(day)) next[key] = day;
  }
  return next;
}

function weekScore(days, weekStart) {
  let total = 0;
  for (let index = 0; index < 7; index += 1) {
    total += dayScore(days[isoDate(addDays(weekStart, index))]);
  }
  return total;
}

function weeksToShow(days, today = new Date()) {
  const current = startOfWeek(today);
  let earliest = null;
  let latest = current;
  for (const key of Object.keys(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isLogged(days[key])) continue;
    const start = startOfWeek(parseISO(key));
    if (!earliest || start < earliest) earliest = start;
    if (start > latest) latest = start;
  }
  if (!earliest) earliest = addDays(current, -28);
  const weeks = [];
  for (let cursor = latest; cursor >= earliest; cursor = addDays(cursor, -7)) {
    weeks.push(cursor);
  }
  return weeks;
}

function beatLabel(thisWeek, lastWeek) {
  if (thisWeek < lastWeek) return `${lastWeek - thisWeek} to beat last week`;
  if (thisWeek > lastWeek) return `Ahead by ${thisWeek - lastWeek}`;
  return "Level with last week";
}

function stillReachable(todayScore, today = new Date()) {
  const day = today.getDay();
  const daysAfter = day === 0 ? 0 : 7 - day;
  return Math.max(0, 10 - todayScore) + daysAfter * 10;
}

function weekdayShort(date) {
  const day = date.getDay();
  return WEEKDAY_SHORT[day === 0 ? 6 : day - 1];
}

function formatWeekLabel(start) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()}`;
  if (sameYear) {
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

function formatDayTitle(date, today = new Date()) {
  const base = `${WEEKDAY_LONG[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === today.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

function formatSheetTitle(date, today = new Date()) {
  if (isoDate(date) === isoDate(today)) return "Today";
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === today.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

function mealLabel(meal) {
  if (meal === "breakfast") return "Breakfast";
  if (meal === "lunch") return "Lunch";
  return "Dinner";
}

function statusLabel(status) {
  if (status === "good") return "Good";
  if (status === "okay") return "Okay";
  if (status === "bad") return "Bad";
  return "Not logged";
}

window.NutriScore = {
  MEALS,
  mealPoints,
  parseISO,
  isoDate,
  addDays,
  startOfWeek,
  normalizeDay,
  isLogged,
  dayScore,
  dayBand,
  normalizeLog,
  weekScore,
  weeksToShow,
  beatLabel,
  stillReachable,
  weekdayShort,
  formatWeekLabel,
  formatDayTitle,
  formatSheetTitle,
  mealLabel,
  statusLabel,
};
