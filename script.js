/**
 * Frontend on Vercel (no trailing slash). WordPress iframe src should point here.
 */
const APP_URL = "https://your-tool.vercel.app".replace(/\/$/, "");

/**
 * Backend on Render (no trailing slash). Must match your live API service.
 */
const API_URL = "https://your-app.onrender.com".replace(/\/$/, "");

console.log("[Drawing Enhancer] APP_URL (Vercel) =", APP_URL);
console.log("[Drawing Enhancer] API_URL (Render) =", API_URL);

function readMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  const v = el?.getAttribute("content")?.trim();
  return v || "";
}

function getUserId() {
  const fromMeta = readMeta("drawing-enhancer-user-id");
  if (fromMeta) return fromMeta;
  try {
    return new URLSearchParams(window.location.search).get("user_id")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** @param {string} path e.g. "/api/upscale" */
function apiEndpoint(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(p, `${API_URL}/`);
  const uid = getUserId();
  if (uid) url.searchParams.set("user_id", uid);
  return url.href;
}

const appRoot = document.getElementById("app-root");
const tabButtons = document.querySelectorAll(".tab-btn");
const panelGenerate = document.getElementById("panel-generate");
const panelUpscale = document.getElementById("panel-upscale");
const promptInput = document.getElementById("prompt-input");
const generateBtn = document.getElementById("generate-btn");
const generateLoading = document.getElementById("generate-loading");
const generateResultWrap = document.getElementById("generate-result-wrap");
const generateResultImg = document.getElementById("generate-result-img");
const generateDownload = document.getElementById("generate-download");
const promptSuggestionsEl = document.getElementById("prompt-suggestions");

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const scaleSelect = document.getElementById("scale-select");
const upscaleBtn = document.getElementById("upscale-btn");
const upscaleLoading = document.getElementById("upscale-loading");
const previewWrapper = document.getElementById("preview-wrapper");
const originalPreview = document.getElementById("original-preview");
const upscaleResults = document.getElementById("upscale-results");
const resultOriginal = document.getElementById("result-original");
const resultUpscaled = document.getElementById("result-upscaled");
const downloadBtn = document.getElementById("download-btn");
const upscaleAgainBtn = document.getElementById("upscale-again-btn");

const errorEl = document.getElementById("error-message");

let selectedFile = null;
let originalImageSrc = "";
let upscaledImageUrl = "";
let generateImageUrl = "";
let busy = false;

const PROMPT_SUGGESTIONS = [
  "watercolor city skyline at sunset, soft light, ultra detailed",
  "clean line art of a cute cat, white background, crisp ink",
  "anime portrait, studio lighting, sharp focus, high detail",
  "fantasy landscape, mountains and river, cinematic, 4k",
  "logo icon, minimal flat vector style, high contrast",
  "product photo on dark background, softbox lighting, realistic",
  "pencil sketch of a vintage car, detailed shading",
  "isometric illustration of a modern workspace, clean, bright",
  "cyberpunk street at night, neon reflections, rain, ultra detailed",
  "children's book illustration, warm colors, friendly characters"
];

function resetError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

function showError(message) {
  console.error("[Drawing Enhancer] Error:", message);
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function setBusy(loading) {
  busy = loading;
  if (appRoot) appRoot.setAttribute("aria-busy", loading ? "true" : "false");
  tabButtons.forEach((b) => {
    b.disabled = loading;
  });
  promptInput.disabled = loading;
  scaleSelect.disabled = loading;
  fileInput.disabled = loading;
  dropZone.classList.toggle("is-disabled", loading);
  if (promptSuggestionsEl) {
    promptSuggestionsEl.querySelectorAll("button").forEach((b) => {
      b.disabled = loading;
    });
  }
}

function bindImageError(img, label) {
  img.addEventListener("error", () => {
    showError(`${label} failed to load. The URL may be invalid, expired, or blocked.`);
  });
}

bindImageError(generateResultImg, "Generated image");
bindImageError(resultUpscaled, "Enhanced image");
bindImageError(originalPreview, "Preview");
bindImageError(resultOriginal, "Original");

function scoreSuggestion(query, suggestion) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const s = suggestion.toLowerCase();
  if (s.startsWith(q)) return 5;
  if (s.includes(q)) return 3;
  const parts = q.split(/\s+/).filter(Boolean);
  if (!parts.length) return 1;
  let hits = 0;
  for (const p of parts) if (s.includes(p)) hits += 1;
  return hits;
}

function renderPromptSuggestions() {
  if (!promptSuggestionsEl) return;

  const query = promptInput.value || "";
  const scored = PROMPT_SUGGESTIONS.map((text) => ({
    text,
    score: scoreSuggestion(query, text)
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = (query.trim() ? scored : scored).slice(0, 8).map((x) => x.text);
  promptSuggestionsEl.innerHTML = "";

  if (!top.length) {
    const empty = document.createElement("div");
    empty.className = "live-suggestions__empty";
    empty.textContent = "No suggestions yet. Keep typing…";
    promptSuggestionsEl.appendChild(empty);
    return;
  }

  top.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-pill";
    btn.textContent = text;
    btn.disabled = busy;
    btn.addEventListener("click", () => {
      if (busy) return;
      promptInput.value = text;
      promptInput.focus();
      renderPromptSuggestions();
    });
    promptSuggestionsEl.appendChild(btn);
  });
}

let suggestionRaf = 0;
promptInput.addEventListener("input", () => {
  if (suggestionRaf) cancelAnimationFrame(suggestionRaf);
  suggestionRaf = requestAnimationFrame(() => {
    renderPromptSuggestions();
  });
});

function normalizeError(err, fallback) {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Could not reach the API. Confirm API_URL in script.js matches your live Render URL and that the service is up (check browser Network tab for CORS or DNS errors).";
  }
  return err?.message || fallback;
}

renderPromptSuggestions();

async function downloadImageUrl(url, filename) {
  if (!url) {
    showError("Nothing to download yet.");
    return;
  }
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    console.log("[Drawing Enhancer] download fetch response", response.status, response.statusText);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const blob = await response.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (e) {
    console.error("[Drawing Enhancer] download failed", e);
    showError(
      "Download could not run inside the iframe (often CORS on the image host). Right-click the image and use Save image as."
    );
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (busy) return;
    const tab = btn.getAttribute("data-tab");
    tabButtons.forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (tab === "generate") {
      panelGenerate.hidden = false;
      panelGenerate.classList.remove("hidden");
      panelUpscale.hidden = true;
      panelUpscale.classList.add("hidden");
    } else {
      panelGenerate.hidden = true;
      panelGenerate.classList.add("hidden");
      panelUpscale.hidden = false;
      panelUpscale.classList.remove("hidden");
    }
    resetError();
  });
});

generateBtn.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showError("Please enter a prompt.");
    return;
  }

  resetError();
  generateResultWrap.classList.add("hidden");
  setBusy(true);
  generateBtn.disabled = true;
  generateLoading.classList.remove("hidden");
  generateLoading.setAttribute("aria-hidden", "false");

  const url = apiEndpoint("/api/generate-image");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ prompt })
    });

    console.log("[Drawing Enhancer] response", response, "status=", response.status, response.statusText);

    let payload = {};
    try {
      payload = await response.json();
    } catch (parseErr) {
      console.error("[Drawing Enhancer] Non-JSON body", parseErr);
      throw new Error("Server returned a non-JSON response. Check Render logs and API_URL.");
    }

    console.log("[Drawing Enhancer] payload", payload);

    if (!response.ok) {
      throw new Error(payload.error || `Generation failed (HTTP ${response.status}).`);
    }
    if (!payload.image || typeof payload.image !== "string") {
      throw new Error("API did not return an image URL.");
    }

    generateImageUrl = payload.image;
    generateResultImg.removeAttribute("src");
    generateResultImg.src = generateImageUrl;
    generateResultWrap.classList.remove("hidden");
  } catch (err) {
    console.error("[Drawing Enhancer] generate-image failed", err);
    showError(normalizeError(err, "Unexpected error while generating."));
  } finally {
    generateLoading.classList.add("hidden");
    generateLoading.setAttribute("aria-hidden", "true");
    generateBtn.disabled = false;
    setBusy(false);
  }
});

generateDownload.addEventListener("click", () => {
  downloadImageUrl(generateImageUrl, "generated-image.png");
});

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) setSelectedFile(file);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-active");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-active");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-active");
  const [file] = e.dataTransfer.files;
  if (file && file.type.startsWith("image/")) {
    setSelectedFile(file);
  } else {
    showError("Please upload a valid image file.");
  }
});

upscaleBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  resetError();
  setBusy(true);
  upscaleBtn.disabled = true;
  upscaleAgainBtn.disabled = true;
  upscaleLoading.classList.remove("hidden");
  upscaleLoading.setAttribute("aria-hidden", "false");

  const url = apiEndpoint("/api/upscale");

  try {
    const formData = new FormData();
    formData.append("image", selectedFile);
    formData.append("scale", scaleSelect.value);

    const response = await fetch(url, {
      method: "POST",
      body: formData
    });

    console.log("[Drawing Enhancer] response", response, "status=", response.status, response.statusText);

    let payload = {};
    try {
      payload = await response.json();
    } catch (parseErr) {
      console.error("[Drawing Enhancer] Non-JSON body", parseErr);
      throw new Error("Server returned a non-JSON response. Check Render logs and API_URL.");
    }

    console.log("[Drawing Enhancer] payload", payload);

    if (!response.ok) {
      throw new Error(payload.error || `Enhancement failed (HTTP ${response.status}).`);
    }
    if (!payload.image || typeof payload.image !== "string") {
      throw new Error("API did not return an image URL.");
    }

    upscaledImageUrl = payload.image;
    resultOriginal.src = originalImageSrc;
    resultUpscaled.removeAttribute("src");
    resultUpscaled.src = upscaledImageUrl;
    upscaleResults.classList.remove("hidden");
  } catch (err) {
    console.error("[Drawing Enhancer] upscale failed", err);
    showError(normalizeError(err, "Unexpected error while enhancing."));
  } finally {
    upscaleLoading.classList.add("hidden");
    upscaleLoading.setAttribute("aria-hidden", "true");
    upscaleBtn.disabled = !selectedFile;
    upscaleAgainBtn.disabled = false;
    setBusy(false);
  }
});

upscaleAgainBtn.addEventListener("click", () => {
  if (busy || !selectedFile) return;
  upscaleBtn.click();
});

downloadBtn.addEventListener("click", () => {
  downloadImageUrl(upscaledImageUrl, "enhanced-drawing.png");
});

function setSelectedFile(file) {
  selectedFile = file;
  if (originalImageSrc.startsWith("blob:")) {
    URL.revokeObjectURL(originalImageSrc);
  }
  originalImageSrc = URL.createObjectURL(file);
  originalPreview.src = originalImageSrc;
  previewWrapper.classList.remove("hidden");
  upscaleBtn.disabled = false;
  upscaleResults.classList.add("hidden");
  resetError();
}
