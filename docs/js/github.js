const API = "https://api.github.com";
const SESSION_KEY = "nutri-session";

let queue = Promise.resolve();

function parseRepo(input) {
  const text = String(input || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const fromUrl = text.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  const fromShort = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  const match = fromUrl || fromShort;
  if (!match) throw new Error("Enter a repo as owner/name or a github.com link.");
  return { owner: match[1], repo: match[2] };
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.owner || !session?.repo || !session?.token || !session?.branch) return null;
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    owner: session.owner,
    repo: session.repo,
    token: session.token,
    branch: session.branch,
  }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function friendlyError(err) {
  if (!err) return "Something went wrong.";
  if (err.status === 401) return "The token was rejected.";
  if (err.status === 403) return err.message || "GitHub refused this token.";
  if (err.status === 404) return "That repo was not found, or the token cannot see it.";
  return err.message || "Something went wrong.";
}

async function connectRepo(repoInput, token) {
  const { owner, repo } = parseRepo(repoInput);
  const trimmed = String(token || "").trim();
  if (!trimmed) throw new Error("Enter the token for this repo.");
  const session = { owner, repo, token: trimmed, branch: "main" };
  const info = await api(session, repoPath(session, ""));
  session.branch = info.default_branch || "main";
  saveSession(session);
  return session;
}

async function loadDays(session) {
  try {
    const file = await api(
      session,
      `${repoPath(session, "/contents/data/days.json")}?ref=${encodeURIComponent(session.branch)}`,
    );
    const text = new TextDecoder().decode(decodeBase64(file.content || ""));
    const days = JSON.parse(text);
    if (!days || typeof days !== "object" || Array.isArray(days)) {
      throw new Error("data/days.json must be a JSON object.");
    }
    return days;
  } catch (err) {
    if (err.status === 404) return {};
    throw err;
  }
}

async function loadPhoto(session, path) {
  const file = await api(
    session,
    `${repoPath(session, `/contents/${encodePath(path)}`)}?ref=${encodeURIComponent(session.branch)}`,
  );
  let content = file.content;
  if (!content && file.sha) {
    const blob = await api(session, repoPath(session, `/git/blobs/${file.sha}`));
    content = blob.content;
  }
  if (!content) throw new Error("Photo was empty.");
  const bytes = decodeBase64(content);
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

function saveChanges(session, payload) {
  const job = queue.then(() => commitWithRetry(session, payload));
  queue = job.then(() => {}, () => {});
  return job;
}

async function commitWithRetry(session, payload) {
  try {
    await commitOnce(session, payload);
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      await commitOnce(session, payload);
      return;
    }
    throw err;
  }
}

async function commitOnce(session, { days, photos, message }) {
  const head = await getHead(session);
  const tree = [];
  for (const photo of photos) {
    const blob = await api(session, repoPath(session, "/git/blobs"), {
      method: "POST",
      body: JSON.stringify({ content: photo.base64, encoding: "base64" }),
    });
    tree.push({ path: photo.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const json = `${JSON.stringify(sortDays(days), null, 2)}\n`;
  const daysBlob = await api(session, repoPath(session, "/git/blobs"), {
    method: "POST",
    body: JSON.stringify({ content: json, encoding: "utf-8" }),
  });
  tree.push({ path: "data/days.json", mode: "100644", type: "blob", sha: daysBlob.sha });
  const treeBody = head.empty ? { tree } : { base_tree: head.treeSha, tree };
  const newTree = await api(session, repoPath(session, "/git/trees"), {
    method: "POST",
    body: JSON.stringify(treeBody),
  });
  const commit = await api(session, repoPath(session, "/git/commits"), {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: head.empty ? [] : [head.commitSha],
    }),
  });
  if (head.empty) {
    await api(session, repoPath(session, "/git/refs"), {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${session.branch}`, sha: commit.sha }),
    });
  } else {
    await api(session, repoPath(session, `/git/refs/heads/${session.branch}`), {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
  }
}

async function getHead(session) {
  try {
    const ref = await api(session, repoPath(session, `/git/refs/heads/${session.branch}`));
    const commit = await api(session, repoPath(session, `/git/commits/${ref.object.sha}`));
    return { empty: false, commitSha: ref.object.sha, treeSha: commit.tree.sha };
  } catch (err) {
    if (err.status === 409) return { empty: true };
    if (err.status === 404) {
      throw new Error(`The data repo has no ${session.branch} branch yet. Add a README commit, then try again.`);
    }
    throw err;
  }
}

function sortDays(days) {
  const sorted = {};
  for (const key of Object.keys(days).sort()) sorted[key] = days[key];
  return sorted;
}

function repoPath(session, suffix) {
  return `/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}${suffix}`;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function api(session, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${session.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const error = new Error(data?.message || response.statusText || "GitHub request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function decodeBase64(content) {
  const binary = atob(String(content).replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

window.NutriGitHub = {
  parseRepo,
  loadSession,
  saveSession,
  clearSession,
  friendlyError,
  connectRepo,
  loadDays,
  loadPhoto,
  saveChanges,
};
