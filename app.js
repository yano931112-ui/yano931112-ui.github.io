const storageKey = "recipe-daybook.v1";

const sampleRecipes = [
  {
    id: crypto.randomUUID(),
    date: today(),
    title: "鶏とトマトのしょうが煮",
    servings: 2,
    time: "25分",
    category: "夕食",
    ingredients: "鶏もも肉 1枚\nトマト 2個\nしょうが 1片\nしょうゆ 大さじ1\nみりん 大さじ1",
    steps: "1. 鶏肉とトマトを食べやすく切る\n2. 鶏肉を焼き、しょうがを加える\n3. トマトと調味料を入れて10分煮る",
    notes: "トマトの酸味が強い日は、みりんを少し足す。",
    favorite: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const state = {
  recipes: loadRecipes(),
  selectedId: null,
  filter: "all",
  search: "",
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

function init() {
  const sharedRecipe = readSharedRecipe();
  if (sharedRecipe) {
    const imported = { ...sharedRecipe, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.recipes.unshift(imported);
    state.selectedId = imported.id;
    saveRecipes();
    history.replaceState(null, "", location.pathname);
    showToast("共有レシピを読み込みました");
  } else {
    state.selectedId = state.recipes[0]?.id ?? null;
  }

  bindEvents();
  if (!state.selectedId) createRecipe();
  render();
}

function bindEvents() {
  els.newRecipeBtn.addEventListener("click", createRecipe);
  els.form.addEventListener("submit", saveCurrentRecipe);
  els.favoriteBtn.addEventListener("click", toggleFavorite);
  els.shareBtn.addEventListener("click", shareCurrentRecipe);
  els.deleteBtn.addEventListener("click", deleteCurrentRecipe);
  els.exportBtn.addEventListener("click", exportRecipes);
  els.importInput.addEventListener("change", importRecipes);
  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderList();
  });
  els.allFilter.addEventListener("click", () => setFilter("all"));
  els.favoriteFilter.addEventListener("click", () => setFilter("favorite"));
}

function loadRecipes() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) && saved.length ? saved : sampleRecipes;
  } catch {
    return sampleRecipes;
  }
}

function saveRecipes() {
  localStorage.setItem(storageKey, JSON.stringify(state.recipes));
}

function createRecipe() {
  const recipe = {
    id: crypto.randomUUID(),
    date: today(),
    title: "",
    servings: 2,
    time: "",
    category: "夕食",
    ingredients: "",
    steps: "",
    notes: "",
    favorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.recipes.unshift(recipe);
  state.selectedId = recipe.id;
  saveRecipes();
  render();
  els.fields.title.focus();
}

function saveCurrentRecipe(event) {
  event.preventDefault();
  const recipe = selectedRecipe();
  if (!recipe) return;

  Object.assign(recipe, formData(), { updatedAt: new Date().toISOString() });
  saveRecipes();
  render();
  showToast("保存しました");
}

function toggleFavorite() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  recipe.favorite = !recipe.favorite;
  recipe.updatedAt = new Date().toISOString();
  saveRecipes();
  render();
}

async function shareCurrentRecipe() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  Object.assign(recipe, formData(), { updatedAt: new Date().toISOString() });
  saveRecipes();

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

function deleteCurrentRecipe() {
  const recipe = selectedRecipe();
  if (!recipe) return;
  const title = recipe.title || "無題のレシピ";
  if (!confirm(`「${title}」を削除しますか？`)) return;
  state.recipes = state.recipes.filter((item) => item.id !== recipe.id);
  state.selectedId = state.recipes[0]?.id ?? null;
  saveRecipes();
  if (!state.selectedId) createRecipe();
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
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported)) throw new Error("Invalid recipe file");
      const cleaned = imported.map(normalizeRecipe);
      state.recipes = mergeRecipes(state.recipes, cleaned);
      state.selectedId = cleaned[0]?.id ?? state.selectedId;
      saveRecipes();
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

function selectRecipe(id) {
  const current = selectedRecipe();
  if (current) Object.assign(current, formData(), { updatedAt: new Date().toISOString() });
  state.selectedId = id;
  saveRecipes();
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
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
  return {
    id: recipe.id || crypto.randomUUID(),
    date: recipe.date || today(),
    title: recipe.title || "",
    servings: Number(recipe.servings) || 1,
    time: recipe.time || "",
    category: recipe.category || "その他",
    ingredients: recipe.ingredients || "",
    steps: recipe.steps || "",
    notes: recipe.notes || "",
    favorite: Boolean(recipe.favorite),
    createdAt: recipe.createdAt || new Date().toISOString(),
    updatedAt: recipe.updatedAt || new Date().toISOString(),
  };
}

function mergeRecipes(current, incoming) {
  const byId = new Map(current.map((recipe) => [recipe.id, recipe]));
  for (const recipe of incoming) byId.set(recipe.id, recipe);
  return [...byId.values()];
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
