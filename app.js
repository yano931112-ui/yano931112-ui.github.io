const storageKey = "recipe-daybook.v1";
const workspaceKey = "recipe-daybook.workspace-id";
const publicWorkspaceId = "00000000-0000-4000-8000-000000000001";
const photoBucket = "recipe-photos";

const state = {
  recipes: [],
  selectedId: null,
  mode: "list",
  filter: "all",
  search: "",
  workspaceId: getWorkspaceId(),
  supabase: createSupabaseClient(),
  supabaseProblem: getSupabaseProblem(),
  remoteReady: false,
  saving: false,
  lastRemoteCount: 0,
  pendingPhotoFile: null,
  pendingPhotoUrl: "",
  removePhoto: false,
};

const els = {
  appShell: document.querySelector("#appShell"),
  list: document.querySelector("#recipeList"),
  form: document.querySelector("#recipeForm"),
  newRecipeBtn: document.querySelector("#newRecipeBtn"),
  backToListBtn: document.querySelector("#backToListBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
  photoInput: document.querySelector("#photoInput"),
  removePhotoBtn: document.querySelector("#removePhotoBtn"),
  photoPreviewImg: document.querySelector("#photoPreviewImg"),
  photoPlaceholder: document.querySelector("#photoPlaceholder"),
  searchInput: document.querySelector("#searchInput"),
  allFilter: document.querySelector("#allFilter"),
  favoriteFilter: document.querySelector("#favoriteFilter"),
  favoriteBtn: document.querySelector("#favoriteBtn"),
  shareBtn: document.querySelector("#shareBtn"),
  deleteBtn: document.querySelector("#deleteBtn"),
  syncBtn: document.querySelector("#syncBtn"),
  syncPanel: document.querySelector("#syncPanel"),
  syncTitle: document.querySelector("#syncTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  toast: document.querySelector("#toast"),
  heroTitle: document.querySelector("#heroTitle"),
  emptyEditor: document.querySelector("#emptyEditor"),
  fields: {
    date: document.querySelector("#dateInput"),
    title: document.querySelector("#titleInput"),
    servings: document.querySelector("#servingsInput"),
    time: document.querySelector("#timeInput"),
    category: document.querySelector("#categoryInput"),
    ingredients: document.querySelector("#ingredientsInput"),
    steps: document.querySelector("#stepsInput"),
    notes: document.querySelector("#notesInput"),
  },
};

init();

async function init() {
  bindEvents();
  state.recipes = loadLocalRecipes();

  if (location.hash.startsWith("#workspace=")) {
    history.replaceState(null, "", location.pathname);
  }

  const sharedRecipe = readSharedRecipe();
  if (sharedRecipe) {
    const imported = {
      ...sharedRecipe,
      id: crypto.randomUUID(),
      workspace_id: state.workspaceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.recipes.unshift(imported);
    state.selectedId = imported.id;
    saveLocalRecipes();
    history.replaceState(null, "", location.pathname);
    showToast("共有レシピを読み込みました");
  }

  if (state.supabase) {
    await loadRemoteRecipes();
  } else {
    state.selectedId = state.selectedId ?? state.recipes[0]?.id ?? null;
    render();
    updateSyncStatus("local");
  }
}

function bindEvents() {
  els.newRecipeBtn.addEventListener("click", () => createRecipe(true));
  els.backToListBtn.addEventListener("click", showList);
  els.form.addEventListener("submit", saveCurrentRecipe);
  els.favoriteBtn.addEventListener("click", toggleFavorite);
  els.shareBtn.addEventListener("click", shareCurrentRecipe);
  els.deleteBtn.addEventListener("click", deleteCurrentRecipe);
  els.exportBtn.addEventListener("click", exportRecipes);
  els.importInput.addEventListener("change", importRecipes);
  els.photoInput.addEventListener("change", previewSelectedPhoto);
  els.removePhotoBtn.addEventListener("click", markPhotoForRemoval);
  els.syncBtn.addEventListener("click", loadRemoteRecipes);
  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderList();
  });
  els.allFilter.addEventListener("click", () => setFilter("all"));
  els.favoriteFilter.addEventListener("click", () => setFilter("favorite"));
}

function createSupabaseClient() {
  const problem = getSupabaseProblem();
  if (problem) return null;

  const config = window.RECIPE_DAYBOOK_SUPABASE;
  return window.supabase.createClient(config.url, config.publishableKey || config.anonKey);
}

function getSupabaseProblem() {
  if (!window.supabase) return "Supabase SDKを読み込めませんでした。ネットワークかCDN読み込みを確認してください。";
  if (!window.RECIPE_DAYBOOK_SUPABASE) return "supabase-config.jsを読み込めませんでした。GitHub Pagesにこのファイルがあるか確認してください。";

  const config = window.RECIPE_DAYBOOK_SUPABASE;
  const url = config?.url;
  const publishableKey = config?.publishableKey || config?.anonKey;

  if (!url || url.includes("YOUR_")) return "supabase-config.jsにProject URLを入れてください。";
  if (!publishableKey || publishableKey.includes("YOUR_")) return "supabase-config.jsにPublishable keyを入れてください。";
  return "";
}

async function loadRemoteRecipes() {
  if (!state.supabase) {
    updateSyncStatus("local");
    showToast(state.supabaseProblem || "Supabase設定を確認してください");
    return;
  }

  updateSyncStatus("loading");
  const { data, error } = await state.supabase
    .from("recipes")
    .select("*")
    .order("date", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("Supabaseから読み込めませんでした");
    return;
  }

  state.remoteReady = true;
  const remoteRecipes = (data || []).map(normalizeRecipe);
  state.lastRemoteCount = remoteRecipes.length;
  const recipes = remoteRecipes.length ? remoteRecipes : state.recipes;
  state.recipes = recipes.filter((recipe) => !isDefaultSampleRecipe(recipe)).map((recipe) => ({
    ...recipe,
    workspace_id: state.workspaceId,
  }));
  saveLocalRecipes();
  if (!remoteRecipes.length) {
    const synced = await syncAllLocalRecipes();
    if (!synced) return;
  }
  state.selectedId = null;
  state.mode = "list";
  render();
  updateSyncStatus("ready");
}

async function syncAllLocalRecipes() {
  if (!state.remoteReady || !state.recipes.length) return true;
  const { error } = await state.supabase.from("recipes").upsert(state.recipes.map(toDatabaseRecipe), { onConflict: "id" });
  if (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("Supabaseへの同期に失敗しました");
    return false;
  }
  return true;
}

function loadLocalRecipes() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) ? saved.map(normalizeRecipe).filter((recipe) => !isDefaultSampleRecipe(recipe)) : [];
  } catch {
    return [];
  }
}

function saveLocalRecipes() {
  localStorage.setItem(storageKey, JSON.stringify(state.recipes));
}

async function persistRecipe(recipe) {
  saveLocalRecipes();
  if (!state.remoteReady) return;

  state.saving = true;
  updateSyncStatus("saving");
  const { error } = await state.supabase.from("recipes").upsert(toDatabaseRecipe(recipe), { onConflict: "id" });
  state.saving = false;

  if (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("ローカルには保存しました。Supabase保存に失敗しました");
    return;
  }

  updateSyncStatus("ready");
}

async function removeRemoteRecipe(id) {
  saveLocalRecipes();
  if (!state.remoteReady) return;

  updateSyncStatus("saving");
  const { error } = await state.supabase.from("recipes").delete().eq("id", id).eq("workspace_id", state.workspaceId);
  if (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("Supabase側の削除に失敗しました");
    return;
  }
  updateSyncStatus("ready");
}

function createRecipe(shouldRender) {
  const recipe = {
    id: crypto.randomUUID(),
    workspace_id: state.workspaceId,
    date: today(),
    title: "",
    servings: 2,
    time: "",
    category: "夕食",
    ingredients: "",
    steps: "",
    notes: "",
    photo_path: "",
    favorite: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.recipes.unshift(recipe);
  state.selectedId = recipe.id;
  state.mode = "detail";
  saveLocalRecipes();
  if (shouldRender) {
    render();
    els.fields.title.focus();
  }
}

async function saveCurrentRecipe(event) {
  event.preventDefault();
  const recipe = selectedRecipe();
  if (!recipe) return;

  const saved = await saveRecipeEdits(recipe);
  if (!saved) return;
  state.selectedId = null;
  state.mode = "list";
  render();
  showToast(state.remoteReady ? "Supabaseに保存しました" : "このブラウザに保存しました");
}

async function toggleFavorite() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  recipe.favorite = !recipe.favorite;
  recipe.updated_at = new Date().toISOString();
  await persistRecipe(recipe);
  render();
}

async function shareCurrentRecipe() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  const saved = await saveRecipeEdits(recipe);
  if (!saved) return;

  const shareUrl = makeShareUrl(recipe);
  const text = `${recipe.title || "無題のレシピ"}\n${shareUrl}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.title || "Recipe Daybook", text, url: shareUrl });
      showToast("共有メニューを開きました");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  await navigator.clipboard.writeText(text);
  showToast("共有リンクをコピーしました");
}

async function deleteCurrentRecipe() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  const title = recipe.title || "無題のレシピ";
  if (!confirm(`「${title}」を削除しますか？`)) return;

  state.recipes = state.recipes.filter((item) => item.id !== recipe.id);
  state.selectedId = state.recipes[0]?.id ?? null;
  await removePhotoFile(recipe.photo_path);
  await removeRemoteRecipe(recipe.id);
  state.selectedId = null;
  state.mode = "list";
  render();
  showToast("削除しました");
}

function exportRecipes() {
  const blob = new Blob([JSON.stringify(state.recipes, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `recipe-daybook-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function importRecipes(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported)) throw new Error("Invalid recipe file");
      const cleaned = imported.map((recipe) => normalizeRecipe({ ...recipe, workspace_id: state.workspaceId }));
      state.recipes = mergeRecipes(state.recipes, cleaned);
      state.selectedId = cleaned[0]?.id ?? state.selectedId;
      saveLocalRecipes();
      await syncAllLocalRecipes();
      render();
      showToast("レシピを読み込みました");
    } catch {
      showToast("読み込みに失敗しました");
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}

function setFilter(filter) {
  state.filter = filter;
  els.allFilter.classList.toggle("active", filter === "all");
  els.favoriteFilter.classList.toggle("active", filter === "favorite");
  renderList();
}

function render() {
  const recipe = selectedRecipe();
  els.appShell.classList.toggle("list-mode", state.mode === "list");
  els.appShell.classList.toggle("detail-mode", state.mode === "detail");
  els.form.hidden = !recipe;
  els.emptyEditor.hidden = Boolean(recipe);
  if (!recipe) {
    els.heroTitle.textContent = "レシピ一覧";
    renderList();
    return;
  }

  els.fields.date.value = recipe.date || today();
  els.fields.title.value = recipe.title || "";
  els.fields.servings.value = recipe.servings || 2;
  els.fields.time.value = recipe.time || "";
  els.fields.category.value = recipe.category || "夕食";
  els.fields.ingredients.value = recipe.ingredients || "";
  els.fields.steps.value = recipe.steps || "";
  els.fields.notes.value = recipe.notes || "";
  setPhotoPreview(state.pendingPhotoUrl || photoUrl(recipe.photo_path));
  els.favoriteBtn.setAttribute("aria-pressed", String(Boolean(recipe.favorite)));
  els.favoriteBtn.querySelector("span").textContent = recipe.favorite ? "★" : "☆";
  els.heroTitle.textContent = recipe.title ? recipe.title : "今日のレシピを残す";
  renderList();
}

function renderList() {
  const items = filteredRecipes();
  els.list.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "recipe-card";
    empty.textContent = "該当するレシピがありません";
    els.list.append(empty);
    return;
  }

  for (const recipe of items) {
    const item = document.createElement("li");
    item.className = `recipe-card${recipe.id === state.selectedId ? " active" : ""}`;
    item.tabIndex = 0;
    const thumbnail = photoUrl(recipe.photo_path);
    item.innerHTML = `
      ${thumbnail ? `<img class="recipe-thumb" src="${escapeHtml(thumbnail)}" alt="" />` : ""}
      <div class="recipe-card-body">
        <strong>${escapeHtml(recipe.title || "無題のレシピ")}</strong>
        <div class="recipe-meta">
          <span>${escapeHtml(formatDate(recipe.date))}</span>
          <span>${escapeHtml(recipe.category || "その他")}</span>
          ${recipe.favorite ? "<span>★</span>" : ""}
        </div>
      </div>
    `;
    item.addEventListener("click", () => selectRecipe(recipe.id));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectRecipe(recipe.id);
    });
    els.list.append(item);
  }
}

async function selectRecipe(id) {
  const current = selectedRecipe();
  if (current) {
    const saved = await saveRecipeEdits(current);
    if (!saved) return;
  }
  state.selectedId = id;
  state.mode = "detail";
  clearPendingPhoto();
  render();
}

function showList() {
  state.selectedId = null;
  state.mode = "list";
  render();
}

function filteredRecipes() {
  return state.recipes
    .filter((recipe) => (state.filter === "favorite" ? recipe.favorite : true))
    .filter((recipe) => {
      if (!state.search) return true;
      return [recipe.title, recipe.date, recipe.category, recipe.ingredients, recipe.steps, recipe.notes]
        .join(" ")
        .toLowerCase()
        .includes(state.search);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updated_at).localeCompare(String(a.updated_at)));
}

function selectedRecipe() {
  return state.recipes.find((recipe) => recipe.id === state.selectedId);
}

function formData() {
  return {
    date: els.fields.date.value || today(),
    title: els.fields.title.value.trim(),
    servings: Number(els.fields.servings.value) || 1,
    time: els.fields.time.value.trim(),
    category: els.fields.category.value,
    ingredients: els.fields.ingredients.value.trim(),
    steps: els.fields.steps.value.trim(),
    notes: els.fields.notes.value.trim(),
  };
}

async function saveRecipeEdits(recipe) {
  const previousPhotoPath = recipe.photo_path || "";
  Object.assign(recipe, formData(), {
    workspace_id: state.workspaceId,
    updated_at: new Date().toISOString(),
  });

  if (state.removePhoto) {
    recipe.photo_path = "";
  }

  if (state.pendingPhotoFile) {
    const uploadedPath = await uploadRecipePhoto(recipe);
    if (!uploadedPath) return false;
    recipe.photo_path = uploadedPath;
  }

  await persistRecipe(recipe);

  if (state.remoteReady && previousPhotoPath && previousPhotoPath !== recipe.photo_path) {
    await removePhotoFile(previousPhotoPath);
  }

  clearPendingPhoto();
  return true;
}

function previewSelectedPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("画像ファイルを選んでください");
    event.target.value = "";
    return;
  }

  if (state.pendingPhotoUrl) URL.revokeObjectURL(state.pendingPhotoUrl);
  state.pendingPhotoFile = file;
  state.pendingPhotoUrl = URL.createObjectURL(file);
  state.removePhoto = false;
  setPhotoPreview(state.pendingPhotoUrl);
}

function markPhotoForRemoval() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  recipe.photo_path = "";
  state.pendingPhotoFile = null;
  state.removePhoto = true;
  els.photoInput.value = "";
  setPhotoPreview("");
}

function clearPendingPhoto() {
  if (state.pendingPhotoUrl) URL.revokeObjectURL(state.pendingPhotoUrl);
  state.pendingPhotoFile = null;
  state.pendingPhotoUrl = "";
  state.removePhoto = false;
  els.photoInput.value = "";
}

async function uploadRecipePhoto(recipe) {
  if (!state.remoteReady) {
    showToast("写真保存にはSupabase接続が必要です");
    return "";
  }

  try {
    const blob = await compressImage(state.pendingPhotoFile);
    const path = `${state.workspaceId}/${recipe.id}/${Date.now()}.webp`;
    const { error } = await state.supabase.storage.from(photoBucket).upload(path, blob, {
      contentType: "image/webp",
      upsert: true,
    });

    if (error) throw error;
    return path;
  } catch (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("写真のアップロードに失敗しました");
    return "";
  }
}

async function removePhotoFile(path) {
  if (!path || !state.remoteReady) return;
  const { error } = await state.supabase.storage.from(photoBucket).remove([path]);
  if (error) console.warn(error);
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const maxSize = 1400;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("画像を圧縮できませんでした"))),
        "image/webp",
        0.82,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    image.src = url;
  });
}

function photoUrl(path) {
  if (!path || !state.supabase) return "";
  const { data } = state.supabase.storage.from(photoBucket).getPublicUrl(path);
  return data.publicUrl;
}

function setPhotoPreview(url) {
  els.photoPreviewImg.hidden = !url;
  els.photoPlaceholder.hidden = Boolean(url);
  els.removePhotoBtn.hidden = !url;
  if (url) {
    els.photoPreviewImg.src = url;
  } else {
    els.photoPreviewImg.removeAttribute("src");
  }
}

function toDatabaseRecipe(recipe) {
  return {
    id: recipe.id,
    workspace_id: recipe.workspace_id,
    date: recipe.date,
    title: recipe.title,
    servings: recipe.servings,
    time: recipe.time,
    category: recipe.category,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    notes: recipe.notes,
    photo_path: recipe.photo_path || "",
    favorite: recipe.favorite,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
  };
}

function makeShareUrl(recipe) {
  if (state.remoteReady) {
    return `${location.origin}${location.pathname}`;
  }

  const shareRecipe = normalizeRecipe({ ...recipe, id: undefined });
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareRecipe))));
  return `${location.origin}${location.pathname}#recipe=${encoded}`;
}

function readSharedRecipe() {
  const match = location.hash.match(/^#recipe=(.+)$/);
  if (!match) return null;
  try {
    return normalizeRecipe(JSON.parse(decodeURIComponent(escape(atob(match[1])))));
  } catch {
    showToast("共有リンクを読み込めませんでした");
    return null;
  }
}

function normalizeRecipe(recipe) {
  const createdAt = recipe.created_at || recipe.createdAt || new Date().toISOString();
  const updatedAt = recipe.updated_at || recipe.updatedAt || new Date().toISOString();
  return {
    id: recipe.id || crypto.randomUUID(),
    workspace_id: recipe.workspace_id || state?.workspaceId || getWorkspaceId(),
    date: recipe.date || today(),
    title: recipe.title || "",
    servings: Number(recipe.servings) || 1,
    time: recipe.time || "",
    category: recipe.category || "その他",
    ingredients: recipe.ingredients || "",
    steps: recipe.steps || "",
    notes: recipe.notes || "",
    photo_path: recipe.photo_path || "",
    favorite: Boolean(recipe.favorite),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function mergeRecipes(current, incoming) {
  const byId = new Map(current.map((recipe) => [recipe.id, recipe]));
  for (const recipe of incoming) {
    const existing = byId.get(recipe.id);
    if (!existing || String(recipe.updated_at) >= String(existing.updated_at)) {
      byId.set(recipe.id, recipe);
    }
  }
  return [...byId.values()];
}

function isDefaultSampleRecipe(recipe) {
  return recipe.title === "鶏とトマトのしょうが煮" && recipe.ingredients.includes("鶏もも肉 1枚") && recipe.steps.includes("10分煮る");
}

function getWorkspaceId() {
  const configId = window.RECIPE_DAYBOOK_SUPABASE?.workspaceId;
  const id = configId || publicWorkspaceId;
  localStorage.setItem(workspaceKey, id);
  return id;
}

function updateSyncStatus(status) {
  const localMessage = state.supabaseProblem || "URLとPublishable keyを入れるまでは、このブラウザだけに保存します。";
  const readyMessage = `DBとこのブラウザに保存します。どのブラウザでも同じレシピを開きます。DBから${state.lastRemoteCount}件取得`;
  const labels = {
    local: ["Supabase未設定", localMessage],
    loading: ["読み込み中", "Supabaseからレシピを取得しています。"],
    saving: ["保存中", "Supabaseへ変更を送っています。"],
    ready: ["Supabase接続中", readyMessage],
    error: ["接続エラー", "テーブル名、RLSポリシー、URL、Publishable keyを確認してください。"],
  };
  const [title, message] = labels[status];
  els.syncTitle.textContent = title;
  els.syncStatus.textContent = message;
  els.syncPanel.hidden = status !== "error" && !(status === "local" && state.supabaseProblem);
}

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00`));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}
