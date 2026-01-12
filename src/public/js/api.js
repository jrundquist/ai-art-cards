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

export async function fetchProjectPreviews(projectId) {
  const res = await fetch(`/api/projects/${projectId}/previews`);
  return await res.json();
}

export async function fetchCardImages(
  projectId,
  cardId,
  includeArchived = false
) {
  const url = `/api/projects/${projectId}/cards/${cardId}/images?includeArchived=${includeArchived}`;
  const res = await fetch(url);
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
  const res = await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  return await res.json();
}

export async function deleteProject(projectId) {
  return await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function deleteCard(projectId, cardId) {
  return await fetch(`/api/projects/${projectId}/cards/${cardId}`, {
    method: "DELETE",
  });
}

export async function generateImages(payload) {
  return await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function downloadGalleryZip(cardId, projectId, filenames) {
  const res = await fetch(`/api/cards/${cardId}/download-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: projectId,
      filenames: filenames,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to download zip");
  }

  // Get the blob
  const blob = await res.blob();

  // Extract filename from Content-Disposition header
  const disposition = res.headers.get("Content-Disposition");
  let filename = "gallery_images.zip";
  if (disposition && disposition.includes("filename=")) {
    const matches = /filename="?([^"]+)"?/.exec(disposition);
    if (matches) filename = matches[1];
  }

  // Create download link and trigger download
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
