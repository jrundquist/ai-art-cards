// API Interaction Layer

export async function fetchKeys() {
  const res = await fetch("/api/keys");
  return await res.json();
}

export async function saveConfig(body) {
  return await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchProjects() {
  const res = await fetch("/api/projects");
  return await res.json();
}

export async function saveProject(project) {
  return await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function fetchCards(projectId) {
  const res = await fetch(`/api/projects/${projectId}/cards`);
  return await res.json();
}

export async function fetchCardImages(projectId, cardId) {
  const res = await fetch(`/api/projects/${projectId}/cards/${cardId}/images`);
  return await res.json();
}

export async function fetchImageMetadata(imgUrl) {
  const res = await fetch(
    `/api/image-metadata?path=${encodeURIComponent(imgUrl)}`
  );
  return await res.json();
}

export async function archiveImage(cardId, projectId, filename) {
  return await fetch(`/api/cards/${cardId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: projectId,
      filename: filename,
    }),
  });
}

export async function toggleFavorite(cardId, projectId, filename) {
  return await fetch(`/api/cards/${cardId}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: projectId,
      filename: filename,
    }),
  });
}

export async function saveCard(card) {
  return await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
}

export async function generateImages(payload) {
  return await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
