const storageKey = "recipe-daybook.v1";
const workspaceKey = "recipe-daybook.workspace-id";

const sampleRecipes = [
  {
    id: crypto.randomUUID(),
    workspace_id: getWorkspaceId(),
    date: today(),
    title: "鶏とトマトのしょうが煮",
    servings: 2,
    time: "25分",
    category: "夕食",
    ingredients: "鶏もも肉 1枚\nトマト 2個\nしょうが 1片\nしょうゆ 大さじ1\nみりん 大さじ1",
    steps: "1. 鶏肉とトマトを食べやすく切る\n2. 鶏肉を焼き、しょうがを加える\n3. トマトと調味料を入れて10分煮る",
    notes: "トマトの酸味が強い日は、みりんを少し足す。",
    favorite: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const state = {
  recipes: [],
  selectedId: null,
  filter: "all",
  search: "",
  workspaceId: getWorkspaceId(),
  supabase: createSupabaseClient(),
  supabaseProblem: getSupabaseProblem(),
  remoteReady: false,
  saving: false,
};

const els = {
  list: document.querySelector("#recipeList"),
  form: document.querySelector("#recipeForm"),
  newRecipeBtn: document.querySelector("#newRecipeBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
  searchInput: document.querySelector("#searchInput"),
  allFilter: document.querySelector("#allFilter"),
  favoriteFilter: document.querySelector("#favoriteFilter"),
  favoriteBtn: document.querySelector("#favoriteBtn"),
  shareBtn: document.querySelector("#shareBtn"),
  deleteBtn: document.querySelector("#deleteBtn"),
  syncBtn: document.querySelector("#syncBtn"),
  syncTitle: document.querySelector("#syncTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  toast: document.querySelector("#toast"),
  heroTitle: document.querySelector("#heroTitle"),
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

  const sharedWorkspace = readSharedWorkspace();
  if (sharedWorkspace) {
    state.workspaceId = sharedWorkspace;
    localStorage.setItem(workspaceKey, sharedWorkspace);
    state.recipes = [];
    state.selectedId = null;
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

  state.selectedId = state.selectedId ?? state.recipes[0]?.id ?? null;
  if (!state.selectedId) createRecipe(false);
  render();

  if (state.supabase) {
    await loadRemoteRecipes();
  } else {
    updateSyncStatus("local");
  }
}

function bindEvents() {
  els.newRecipeBtn.addEventListener("click", () => createRecipe(true));
  els.form.addEventListener("submit", saveCurrentRecipe);
  els.favoriteBtn.addEventListener("click", toggleFavorite);
  els.shareBtn.addEventListener("click", shareCurrentRecipe);
  els.deleteBtn.addEventListener("click", deleteCurrentRecipe);
  els.exportBtn.addEventListener("click", exportRecipes);
  els.importInput.addEventListener("change", importRecipes);
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
    .eq("workspace_id", state.workspaceId)
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
  state.recipes = mergeRecipes(remoteRecipes, state.recipes).map((recipe) => ({
    ...recipe,
    workspace_id: state.workspaceId,
  }));
  saveLocalRecipes();
  await syncAllLocalRecipes();
  state.selectedId = state.recipes[0]?.id ?? null;
  render();
  updateSyncStatus("ready");
}

async function syncAllLocalRecipes() {
  if (!state.remoteReady || !state.recipes.length) return;
  const { error } = await state.supabase.from("recipes").upsert(state.recipes, { onConflict: "id" });
  if (error) {
    console.error(error);
    updateSyncStatus("error");
    showToast("Supabaseへの同期に失敗しました");
  }
}

function loadLocalRecipes() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) && saved.length ? saved.map(normalizeRecipe) : sampleRecipes;
  } catch {
    return sampleRecipes;
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
  const { error } = await state.supabase.from("recipes").upsert(recipe, { onConflict: "id" });
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
    favorite: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.recipes.unshift(recipe);
  state.selectedId = recipe.id;
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

  Object.assign(recipe, formData(), {
    workspace_id: state.workspaceId,
    updated_at: new Date().toISOString(),
  });
  await persistRecipe(recipe);
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
  Object.assign(recipe, formData(), { updated_at: new Date().toISOString() });
  await persistRecipe(recipe);

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
  if (!state.selectedId) createRecipe(false);
  await removeRemoteRecipe(recipe.id);
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
  if (!recipe) return;
  els.fields.date.value = recipe.date || today();
  els.fields.title.value = recipe.title || "";
  els.fields.servings.value = recipe.servings || 2;
  els.fields.time.value = recipe.time || "";
  els.fields.category.value = recipe.category || "夕食";
  els.fields.ingredients.value = recipe.ingredients || "";
  els.fields.steps.value = recipe.steps || "";
  els.fields.notes.value = recipe.notes || "";
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
    item.innerHTML = `
      <strong>${escapeHtml(recipe.title || "無題のレシピ")}</strong>
      <div class="recipe-meta">
        <span>${escapeHtml(formatDate(recipe.date))}</span>
        <span>${escapeHtml(recipe.category || "その他")}</span>
        ${recipe.favorite ? "<span>★</span>" : ""}
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
    Object.assign(current, formData(), { updated_at: new Date().toISOString() });
    await persistRecipe(current);
  }
  state.selectedId = id;
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

function makeShareUrl(recipe) {
  if (state.remoteReady) {
    return `${location.origin}${location.pathname}#workspace=${encodeURIComponent(state.workspaceId)}`;
  }

  const shareRecipe = normalizeRecipe({ ...recipe, id: undefined });
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareRecipe))));
  return `${location.origin}${location.pathname}#recipe=${encoded}`;
}

function readSharedWorkspace() {
  const match = location.hash.match(/^#workspace=(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
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

function getWorkspaceId() {
  let id = localStorage.getItem(workspaceKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(workspaceKey, id);
  }
  return id;
}

function updateSyncStatus(status) {
  const localMessage = state.supabaseProblem || "URLとPublishable keyを入れるまでは、このブラウザだけに保存します。";
  const labels = {
    local: ["Supabase未設定", localMessage],
    loading: ["読み込み中", "Supabaseからレシピを取得しています。"],
    saving: ["保存中", "Supabaseへ変更を送っています。"],
    ready: ["Supabase接続中", "DBとこのブラウザに保存します。共有リンクで同じレシピ帳を開けます。"],
    error: ["接続エラー", "テーブル名、RLSポリシー、URL、Publishable keyを確認してください。"],
  };
  const [title, message] = labels[status];
  els.syncTitle.textContent = title;
  els.syncStatus.textContent = message;
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
