(function () {
  "use strict";

  // --- Food database (nickel_foods.json) ---
  let foodDatabase = null; // { foods: [] } or null

  function loadFoodDatabase() {
    if (foodDatabase !== null) return Promise.resolve(foodDatabase);
    return fetch("nickel_foods.json")
      .then(function (r) {
        if (!r.ok) throw new Error("Fetch failed");
        return r.json();
      })
      .then(function (data) {
        foodDatabase = data;
        return data;
      });
  }

  function getFoods() {
    return foodDatabase && foodDatabase.foods ? foodDatabase.foods : [];
  }

  function searchFoods(query) {
    const q = (query || "").trim().toLowerCase();
    const foods = getFoods();
    if (!q) return foods.slice(0, 100);
    return foods.filter(function (f) {
      const name = (f.name_en || "").toLowerCase();
      const cat = (f.category || "").toLowerCase();
      return name.indexOf(q) !== -1 || cat.indexOf(q) !== -1;
    });
  }

  /** Find best matching food for an AI-suggested item (e.g. "scrambled eggs"). Returns food or null. */
  function findBestMatchForItem(itemName) {
    var result = findMatchesWithConfidence(itemName);
    return result.best;
  }

  var DISAMBIGUATION_THRESHOLD = 0.7;

  /** Simple string similarity 0..1: substring match or token overlap. */
  function nameSimilarity(query, foodName) {
    var q = (query || "").trim().toLowerCase();
    var n = (foodName || "").toLowerCase();
    if (!q || !n) return 0;
    if (n.indexOf(q) >= 0) return 0.95;
    var qTokens = q.split(/\s+/).filter(Boolean);
    var nTokens = n.split(/\s+/).filter(Boolean);
    if (qTokens.length === 0) return 0.5;
    var match = 0;
    for (var i = 0; i < qTokens.length; i++) {
      for (var j = 0; j < nTokens.length; j++) {
        if (nTokens[j].indexOf(qTokens[i]) >= 0 || qTokens[i].indexOf(nTokens[j]) >= 0) {
          match++;
          break;
        }
      }
    }
    return (match / qTokens.length) * 0.9;
  }

  /**
   * Returns { matches, confidence, best }.
   * confidence is in [0,1]; below DISAMBIGUATION_THRESHOLD we show picker.
   */
  function findMatchesWithConfidence(itemName) {
    var name = (itemName || "").trim();
    if (!name) return { matches: [], confidence: 0, best: null };
    var foods = searchFoods(name);
    if (foods.length === 0) {
      var withoutNumbers = name.replace(/\b\d+\s*/g, "").trim();
      if (withoutNumbers && withoutNumbers !== name) foods = searchFoods(withoutNumbers);
    }
    if (foods.length === 0) {
      var firstWord = name.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 2) foods = searchFoods(firstWord);
    }
    if (foods.length === 0) return { matches: [], confidence: 0, best: null };
    var best = foods[0];
    var similarity = nameSimilarity(name, best.name_en || best.id);
    var numPenalty = 1 / (1 + 0.2 * (foods.length - 1));
    var confidence = similarity * numPenalty;
    return { matches: foods, confidence: confidence, best: best };
  }

  function nickelUgForFood(food) {
    if (food.nickel_ug_per_serving != null) return Math.round(food.nickel_ug_per_serving * 10) / 10;
    if (food.nickel_ug_per_100g != null && food.serving_size_g != null && food.serving_size_g > 0) {
      return Math.round((food.nickel_ug_per_100g * food.serving_size_g / 100) * 10) / 10;
    }
    if (food.nickel_ug_per_100g != null) return Math.round(food.nickel_ug_per_100g * 10) / 10;
    return 0;
  }

  var BAND_LABELS = { very_low: "Very low", low: "Low", medium: "Medium", high: "High" };
  function getBandLabel(bandId) {
    return (bandId && BAND_LABELS[bandId]) ? BAND_LABELS[bandId] : "—";
  }
  function getBandClass(bandId) {
    return (bandId && BAND_LABELS[bandId]) ? " band-" + bandId : "";
  }

  // --- Serving units: US (volume when possible, else oz) vs metric (g) ---
  const SERVING_UNITS_KEY = "nickeltrack-serving-units";
  function getServingUnits() {
    try {
      const v = localStorage.getItem(SERVING_UNITS_KEY);
      return (v === "metric" || v === "us") ? v : "us";
    } catch (_) {
      return "us";
    }
  }
  function setServingUnits(val) {
    try {
      localStorage.setItem(SERVING_UNITS_KEY, val === "metric" ? "metric" : "us");
    } catch (_) {}
  }
  // US volume approximations (grams → cup/tbsp/tsp); else oz (1 oz ≈ 28.35 g)
  var US_VOLUME_MAP = [
    [5, "1 tsp"], [15, "1 tbsp"], [30, "2 tbsp"], [45, "3 tbsp"],
    [60, "¼ cup"], [80, "⅓ cup"], [120, "½ cup"], [240, "1 cup"], [250, "1 cup"]
  ];
  function formatServingSize(grams) {
    if (grams == null || grams <= 0) return "";
    var units = getServingUnits();
    if (units === "metric") {
      return Math.round(grams) + " g";
    }
    var g = grams;
    for (var i = 0; i < US_VOLUME_MAP.length; i++) {
      var diff = Math.abs(g - US_VOLUME_MAP[i][0]);
      if (diff < 3 || diff <= US_VOLUME_MAP[i][0] * 0.15) return US_VOLUME_MAP[i][1];
    }
    var oz = g / 28.35;
    return (oz < 1 ? oz.toFixed(2) : (oz < 10 ? oz.toFixed(1) : Math.round(oz))) + " oz";
  }

  function renderFoodResult(food, options) {
    const µg = nickelUgForFood(food);
    const bandId = food.nickel_band || null;
    const bandLabel = getBandLabel(bandId);
    const bandClass = getBandClass(bandId);
    var servingGrams = food.serving_size_g != null ? food.serving_size_g : (food.nickel_ug_per_100g != null ? 100 : null);
    var servingStr = servingGrams != null ? formatServingSize(servingGrams) : "";
    var servingLabel = servingStr ? (servingGrams === 100 ? "per " + servingStr : servingStr) : "";
    const line2 = food.nickel_ug_per_serving != null
      ? µg + " µg/serving" + (servingLabel ? " (" + servingLabel + ")" : "")
      : (food.nickel_ug_per_100g != null ? µg + " µg (est. " + (servingLabel || "100 g") + ")" : "");
    const div = document.createElement("div");
    div.className = "food-result card" + bandClass;
    div.setAttribute("role", "listitem");
    div.innerHTML =
      "<div class=\"food-result-name\">" +
      (bandId ? "<span class=\"band-badge band-" + bandId + "\">" + escapeHtml(bandLabel) + "</span> " : "") +
      escapeHtml(food.name_en || food.id) +
      (servingLabel ? " <span class=\"food-serving-size\">(" + escapeHtml(servingLabel) + ")</span>" : "") +
      "</div>" +
      "<div class=\"food-result-meta\">" + escapeHtml(line2) + (bandId ? " · " + escapeHtml(bandLabel) + " nickel" : "") + "</div>" +
      (options && options.showAddButton
        ? "<button type=\"button\" class=\"btn btn-primary btn-add-food\" data-food-id=\"" + escapeHtml(food.id) + "\">Add</button>"
        : "");
    return div;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderSearchResults(foods, container, options) {
    if (!container) return;
    container.innerHTML = "";
    if (!foods.length) {
      container.appendChild(document.createTextNode("No foods match your search."));
      return;
    }
    foods.forEach(function (food) {
      const node = renderFoodResult(food, options);
      if (options && options.onAddClick && food.id) {
        const btn = node.querySelector(".btn-add-food");
        if (btn) btn.addEventListener("click", function () { options.onAddClick(food); });
      }
      container.appendChild(node);
    });
  }

  // --- Section navigation (Option B: separate views) ---
  const navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll(".page-section");

  function showSection(sectionId) {
    sections.forEach(function (section) {
      const isTarget = section.id === sectionId;
      section.classList.toggle("is-visible", isTarget);
      section.hidden = !isTarget;
    });
    navLinks.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("data-section") === sectionId);
    });
    history.replaceState(null, "", "#" + sectionId);
  }

  function getSectionFromHash() {
    const hash = (window.location.hash || "#meal-tracking").slice(1);
    return ["meal-tracking", "food-database", "recipes", "meal-planner", "resources"].includes(hash)
      ? hash
      : "meal-tracking";
  }

  navLinks.forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      showSection(link.getAttribute("data-section"));
    });
  });

  window.addEventListener("hashchange", function () {
    showSection(getSectionFromHash());
  });

  showSection(getSectionFromHash());

  // --- Food database section: load data and search ---
  const foodSearchInput = document.getElementById("food-search");
  const searchResultsEl = document.getElementById("search-results");
  const searchStatusEl = document.getElementById("search-status");
  const databaseLoadError = document.getElementById("database-load-error");

  function runDatabaseSearch() {
    const query = foodSearchInput ? foodSearchInput.value : "";
    const foods = searchFoods(query);
    renderSearchResults(foods, searchResultsEl, {});
    if (searchStatusEl) searchStatusEl.textContent = foods.length + " food(s)";
  }

  function onShowFoodDatabase() {
    loadFoodDatabase()
      .then(function () {
        if (databaseLoadError) databaseLoadError.hidden = true;
        runDatabaseSearch();
      })
      .catch(function () {
        if (databaseLoadError) databaseLoadError.hidden = false;
        if (searchResultsEl) searchResultsEl.innerHTML = "";
        if (searchStatusEl) searchStatusEl.textContent = "";
      });
  }

  if (foodSearchInput) {
    foodSearchInput.addEventListener("input", runDatabaseSearch);
    foodSearchInput.addEventListener("focus", runDatabaseSearch);
  }

  // --- Meal entries: persistence and rendering (servings, remove, band) ---
  const MEAL_ENTRIES_KEY = "nickeltrack-meal-entries";
  const SERVING_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];

  function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function getStoredEntries() {
    try {
      const raw = localStorage.getItem(MEAL_ENTRIES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function setStoredEntries(data) {
    try {
      localStorage.setItem(MEAL_ENTRIES_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function getTodayMealEntries() {
    const all = getStoredEntries();
    const today = getTodayDate();
    if (!all[today]) all[today] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    return all[today];
  }

  function saveTodayMealEntries(mealData) {
    const all = getStoredEntries();
    all[getTodayDate()] = mealData;
    setStoredEntries(all);
  }

  function buildEntryFromFood(food) {
    var servingG = food.serving_size_g != null ? food.serving_size_g : (food.nickel_ug_per_100g != null ? 100 : null);
    return {
      foodId: food.id,
      name_en: food.name_en || food.id,
      nickelUgPerServing: nickelUgForFood(food),
      servings: 1,
      nickel_band: food.nickel_band || null,
      serving_size_g: servingG,
    };
  }

  function renderMealEntry(entry, meal, index) {
    const total = Math.round(entry.nickelUgPerServing * entry.servings * 10) / 10;
    const bandId = entry.nickel_band || "";
    const bandLabel = getBandLabel(entry.nickel_band);
    const bandClass = getBandClass(entry.nickel_band);
    const li = document.createElement("li");
    li.setAttribute("data-meal", meal);
    li.setAttribute("data-entry-index", String(index));
    li.setAttribute("data-nickel-per-serving", String(entry.nickelUgPerServing));
    li.setAttribute("data-servings", String(entry.servings));
    li.setAttribute("data-nickel-total", String(total));
    li.className = "meal-entry-row" + (bandId ? " band-" + bandId : "");
    var servingOpts = SERVING_OPTIONS.map(function (s) {
      return "<option value=\"" + s + "\"" + (entry.servings === s ? " selected" : "") + ">" + s + "</option>";
    }).join("");
    var entryServingStr = (entry.serving_size_g != null && entry.serving_size_g > 0) ? formatServingSize(entry.serving_size_g) : "";
    li.innerHTML =
      "<div class=\"meal-entry-info\">" +
        "<div class=\"meal-entry-name\">" +
          (bandId ? "<span class=\"band-badge band-" + bandId + "\">" + escapeHtml(bandLabel) + "</span> " : "") +
          escapeHtml(entry.name_en) +
          (entryServingStr ? " <span class=\"meal-entry-serving-size\">(" + escapeHtml(entryServingStr) + ")</span>" : "") +
        "</div>" +
        "<div class=\"meal-entry-meta\">" + total + " µg</div>" +
      "</div>" +
      "<div class=\"meal-entry-servings\">" +
        "<label for=\"servings-" + meal + "-" + index + "\">Servings</label>" +
        "<select id=\"servings-" + meal + "-" + index + "\" class=\"meal-servings-select\" data-meal=\"" + escapeHtml(meal) + "\" data-index=\"" + index + "\">" + servingOpts + "</select>" +
      "</div>" +
      "<div class=\"meal-entry-actions\">" +
        "<button type=\"button\" class=\"btn-remove-entry\" data-meal=\"" + escapeHtml(meal) + "\" data-index=\"" + index + "\" aria-label=\"Remove\">Remove</button>" +
      "</div>";
    return li;
  }

  function renderMealList(meal, entries) {
    const list = document.querySelector('.meal-entries[data-meal="' + meal + '"]');
    if (!list) return;
    list.innerHTML = "";
    if (!entries || entries.length === 0) {
      const hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No entries yet.";
      list.appendChild(hint);
      return;
    }
    entries.forEach(function (entry, index) {
      list.appendChild(renderMealEntry(entry, meal, index));
    });
    attachMealEntryListeners(meal);
  }

  function attachMealEntryListeners(meal) {
    const list = document.querySelector('.meal-entries[data-meal="' + meal + '"]');
    if (!list) return;
    list.querySelectorAll(".btn-remove-entry").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        const mealData = getTodayMealEntries();
        const arr = mealData[meal] || [];
        arr.splice(idx, 1);
        mealData[meal] = arr;
        saveTodayMealEntries(mealData);
        renderMealList(meal, arr);
        recomputeDailyTotal();
      });
    });
    list.querySelectorAll(".meal-servings-select").forEach(function (select) {
      select.addEventListener("change", function () {
        const idx = parseInt(select.getAttribute("data-index"), 10);
        const newServings = parseFloat(select.value, 10);
        const mealData = getTodayMealEntries();
        const arr = mealData[meal] || [];
        if (arr[idx]) {
          arr[idx].servings = newServings;
          saveTodayMealEntries(mealData);
          var li = list.querySelector("li[data-entry-index=\"" + idx + "\"]");
          if (li) {
            var total = Math.round(arr[idx].nickelUgPerServing * newServings * 10) / 10;
            li.setAttribute("data-servings", String(newServings));
            li.setAttribute("data-nickel-total", String(total));
            var meta = li.querySelector(".meal-entry-meta");
            if (meta) meta.textContent = total + " µg";
          }
          recomputeDailyTotal();
        }
      });
    });
  }

  function loadAndRenderAllMeals() {
    var mealData = getTodayMealEntries();
    ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
      renderMealList(meal, mealData[meal] || []);
    });
    recomputeDailyTotal();
  }

  // --- Add-to-meal modal ---
  const addToMealModal = document.getElementById("add-to-meal-modal");
  const modalMealName = document.getElementById("modal-meal-name");
  const modalFoodSearch = document.getElementById("modal-food-search");
  const modalResults = document.getElementById("modal-results");
  const modalCancel = document.getElementById("modal-cancel");
  const mealLabels = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
  let currentAddMeal = null;

  function openAddToMealModal(meal) {
    currentAddMeal = meal;
    if (modalMealName) modalMealName.textContent = "Add to " + (mealLabels[meal] || meal);
    if (modalFoodSearch) { modalFoodSearch.value = ""; modalFoodSearch.focus(); }
    runModalSearch();
    if (addToMealModal) addToMealModal.hidden = false;
  }

  function closeAddToMealModal() {
    currentAddMeal = null;
    if (addToMealModal) addToMealModal.hidden = true;
  }

  function runModalSearch() {
    const query = modalFoodSearch ? modalFoodSearch.value : "";
    const foods = searchFoods(query);
    renderSearchResults(foods, modalResults, {
      showAddButton: true,
      onAddClick: function (food) {
        if (!currentAddMeal) return;
        const mealData = getTodayMealEntries();
        const arr = mealData[currentAddMeal] || [];
        arr.push(buildEntryFromFood(food));
        mealData[currentAddMeal] = arr;
        saveTodayMealEntries(mealData);
        renderMealList(currentAddMeal, arr);
        recomputeDailyTotal();
        closeAddToMealModal();
      },
    });
  }

  if (modalFoodSearch) modalFoodSearch.addEventListener("input", runModalSearch);
  if (modalCancel) modalCancel.addEventListener("click", closeAddToMealModal);
  if (addToMealModal) {
    addToMealModal.addEventListener("click", function (e) {
      if (e.target === addToMealModal) closeAddToMealModal();
    });
  }

  // When navigating to Food database, load and run search
  showSection = function (sectionId) {
    sections.forEach(function (section) {
      const isTarget = section.id === sectionId;
      section.classList.toggle("is-visible", isTarget);
      section.hidden = !isTarget;
    });
    navLinks.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("data-section") === sectionId);
    });
    history.replaceState(null, "", "#" + sectionId);
    if (sectionId === "food-database") onShowFoodDatabase();
  };

  if (getSectionFromHash() === "food-database") onShowFoodDatabase();

  function refreshServingUnitsDisplay() {
    runDatabaseSearch();
    if (currentAddMeal && modalResults) runModalSearch();
    loadAndRenderAllMeals();
  }

  var unitsBtns = document.querySelectorAll(".units-btn");
  function updateUnitsToggleActive() {
    var current = getServingUnits();
    unitsBtns.forEach(function (btn) {
      var isUs = btn.getAttribute("data-units") === "us";
      var isActive = (current === "us" && isUs) || (current === "metric" && !isUs);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
  updateUnitsToggleActive();
  unitsBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var u = btn.getAttribute("data-units");
      if (u === "metric" || u === "us") {
        setServingUnits(u);
        updateUnitsToggleActive();
        refreshServingUnitsDisplay();
      }
    });
  });

  // --- Meal tracking: daily total & goal (placeholder) ---
  const todayTotalEl = document.getElementById("today-total");
  const todayGoalEl = document.getElementById("today-goal");
  const DAILY_GOAL_DEFAULT = 150; // µg placeholder

  if (todayGoalEl) todayGoalEl.textContent = DAILY_GOAL_DEFAULT;

  function getStoredGoal() {
    try {
      const v = localStorage.getItem("nickeltrack-daily-goal");
      return v != null ? parseInt(v, 10) : DAILY_GOAL_DEFAULT;
    } catch (_) {
      return DAILY_GOAL_DEFAULT;
    }
  }

  function setStoredGoal(µg) {
    try {
      localStorage.setItem("nickeltrack-daily-goal", String(µg));
    } catch (_) {}
  }

  function recomputeDailyTotal() {
    if (!todayTotalEl) return;
    var total = 0;
    document.querySelectorAll(".meal-entries [data-nickel-total]").forEach(function (el) {
      total += parseFloat(el.getAttribute("data-nickel-total"), 10) || 0;
    });
    todayTotalEl.textContent = Math.round(total * 10) / 10;
  }

  function renderGoal() {
    const goal = getStoredGoal();
    if (todayGoalEl) todayGoalEl.textContent = goal;
  }

  renderGoal();

  loadAndRenderAllMeals();

  // --- Add entry: open food database modal ---
  document.querySelectorAll(".add-entry").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const meal = btn.getAttribute("data-meal");
      if (!meal) return;
      loadFoodDatabase()
        .then(function () {
          openAddToMealModal(meal);
        })
        .catch(function () {
          alert("Food database could not be loaded. Make sure nickel_foods.json exists (run build_nickel_database.py).");
        });
    });
  });

  // --- Suggest foods with AI (parse meal description, match, auto-add; show unmatched per meal) ---
  function showUnmatched(meal, items) {
    var block = document.querySelector(".meal-unmatched[data-meal=\"" + meal + "\"]");
    if (!block) return;
    var listEl = block.querySelector(".unmatched-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!items || items.length === 0) {
      block.hidden = true;
      return;
    }
    items.forEach(function (name) {
      var li = document.createElement("li");
      li.textContent = name;
      listEl.appendChild(li);
    });
    block.hidden = false;
  }

  function getParseMealApiUrl() {
    if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
      return window.location.origin + "/api/parse-meal";
    }
    return "http://localhost:5000/api/parse-meal";
  }

  function getPickFoodApiUrl() {
    if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
      return window.location.origin + "/api/pick-food";
    }
    return "http://localhost:5000/api/pick-food";
  }

  /** Minimum confidence (0–1) from AI pick-food to accept a match; below this we treat as no match. */
  var LIKELIHOOD_CUTOFF = 0.5;

  /** When we have 0 matches, use these to get candidate foods for AI pick. */
  var PICK_FOOD_SYNONYMS = {
    steak: ["beef", "meat"],
    toast: ["bread", "toasted"],
    chicken: ["poultry", "chicken"],
    fish: ["fish", "seafood"],
    pork: ["pork", "meat"],
    turkey: ["turkey", "poultry"],
    lamb: ["lamb", "meat"],
    bacon: ["pork", "bacon"],
    sausage: ["sausage", "pork", "meat"],
    cheese: ["cheese", "dairy"],
    milk: ["milk", "dairy"],
    butter: ["butter", "dairy"],
    egg: ["egg", "eggs"],
    eggs: ["egg", "eggs"],
    oj: ["orange", "juice"],
    "orange juice": ["orange", "juice"],
    coffee: ["coffee", "beverage"],
    tea: ["tea", "beverage"],
    salad: ["lettuce", "vegetable", "salad"],
    potato: ["potato", "potatoes"],
    rice: ["rice", "grain"],
    pasta: ["pasta", "noodle"],
    bread: ["bread", "roll"],
    yogurt: ["yogurt", "yoghurt"],
    cereal: ["cereal", "grain"],
  };

  /** True if word appears as a whole word in name (avoids e.g. egg matching eggplant). */
  function wholeWordInName(word, foodName) {
    if (!word || !foodName) return false;
    var n = (foodName || "").toLowerCase();
    var w = (word || "").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + w + "\\b").test(n);
  }

  /** True if the food name is relevant to the query word (whole word or singular/plural). */
  function wordRelevantToName(word, foodName) {
    if (!word || !foodName) return false;
    if (wholeWordInName(word, foodName)) return true;
    if (word.length > 1 && word[word.length - 1] === "s" && wholeWordInName(word.slice(0, -1), foodName)) return true;
    if (wholeWordInName(word + "s", foodName)) return true;
    return false;
  }

  function getCandidatesForNoMatch(itemName) {
    var name = (itemName || "").trim().toLowerCase();
    if (!name) return [];
    var firstWord = name.split(/\s+/)[0];
    var seen = {};
    var out = [];
    function addFromSearch(q) {
      var foods = searchFoods(q);
      foods.forEach(function (f) {
        var id = f.id;
        if (seen[id]) return;
        var fn = f.name_en || f.id;
        if (!wordRelevantToName(q, fn) && !wordRelevantToName(firstWord, fn)) return;
        seen[id] = true;
        out.push(f);
      });
    }
    if (firstWord && firstWord.length >= 2) addFromSearch(firstWord);
    var synonyms = PICK_FOOD_SYNONYMS[name] || PICK_FOOD_SYNONYMS[firstWord];
    if (synonyms) {
      for (var i = 0; i < synonyms.length; i++) addFromSearch(synonyms[i]);
    }
    addFromSearch(name);
    return out.slice(0, 25);
  }

  function callPickFoodApi(userPhrase, candidates) {
    var names = candidates.map(function (f) { return f.name_en || f.id; });
    return fetch(getPickFoodApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPhrase: userPhrase, candidates: names }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || r.statusText); });
        return r.json();
      })
      .then(function (data) {
        var ranked = data.ranked || [];
        var above = ranked.filter(function (r) { return r.confidence >= LIKELIHOOD_CUTOFF; });
        var top = above.length > 0 ? above[0] : null;
        if (!top || !top.name) return null;
        var chosenName = top.name;
        for (var i = 0; i < candidates.length; i++) {
          if ((candidates[i].name_en || candidates[i].id) === chosenName) return candidates[i];
        }
        var chosenLower = chosenName.toLowerCase();
        for (var j = 0; j < candidates.length; j++) {
          var fn = (candidates[j].name_en || candidates[j].id || "").toLowerCase();
          if (fn === chosenLower || fn.indexOf(chosenLower) >= 0 || chosenLower.indexOf(fn) >= 0) return candidates[j];
        }
        return null;
      });
  }

  var disambiguateModal = document.getElementById("disambiguate-modal");
  var disambiguateTitle = document.getElementById("disambiguate-title");
  var disambiguateQuery = document.getElementById("disambiguate-query");
  var disambiguateList = document.getElementById("disambiguate-list");
  var disambiguateSkip = document.getElementById("disambiguate-skip");

  /** Show "Which 'X'?" modal; returns Promise<food|null>. */
  function showDisambiguationModal(query, matches) {
    return new Promise(function (resolve) {
      if (!disambiguateModal || !disambiguateList) {
        resolve(matches.length > 0 ? matches[0] : null);
        return;
      }
      if (disambiguateTitle) disambiguateTitle.textContent = "Which one?";
      if (disambiguateQuery) disambiguateQuery.textContent = "You said \"" + (query || "") + "\". Pick the best match:";
      disambiguateList.innerHTML = "";
      matches.forEach(function (food) {
        var li = document.createElement("li");
        var µg = nickelUgForFood(food);
        var bandLabel = getBandLabel(food.nickel_band);
        li.innerHTML =
          "<button type=\"button\" class=\"disambiguate-option\" data-food-id=\"" + escapeHtml(food.id) + "\">" +
            "<span class=\"option-name\">" + escapeHtml(food.name_en || food.id) + "</span>" +
            "<span class=\"option-meta\">" + µg + " µg/serving" + (food.nickel_band ? " · " + bandLabel : "") + "</span>" +
          "</button>";
        li.querySelector("button").addEventListener("click", function () {
          disambiguateModal.hidden = true;
          resolve(food);
        });
        disambiguateList.appendChild(li);
      });
      function finish(val) {
        disambiguateModal.hidden = true;
        resolve(val);
      }
      if (disambiguateSkip) {
        disambiguateSkip.onclick = function () { finish(null); };
      }
      disambiguateModal.hidden = false;
    });
  }

  function processAiItems(meal, items, mealData, matched, unmatched) {
    var i = 0;
    function next() {
      if (i >= items.length) {
        var arr = mealData[meal] || [];
        matched.forEach(function (f) { arr.push(buildEntryFromFood(f)); });
        mealData[meal] = arr;
        saveTodayMealEntries(mealData);
        renderMealList(meal, arr);
        recomputeDailyTotal();
        showUnmatched(meal, unmatched);
        return Promise.resolve();
      }
      var itemName = items[i++];
      var result = findMatchesWithConfidence(itemName);
      if (result.matches.length === 0) {
        var candidates = getCandidatesForNoMatch(itemName);
        if (candidates.length === 0) {
          unmatched.push(itemName);
          return next();
        }
        return callPickFoodApi(itemName, candidates).then(function (chosen) {
          if (chosen) matched.push(chosen);
          else unmatched.push(itemName);
          return next();
        }).catch(function () {
          unmatched.push(itemName);
          return next();
        });
      }
      if (result.confidence >= DISAMBIGUATION_THRESHOLD) {
        matched.push(result.best);
        return next();
      }
      return showDisambiguationModal(itemName, result.matches).then(function (selected) {
        if (selected) matched.push(selected);
        return next();
      });
    }
    return next();
  }

  document.querySelectorAll(".btn-suggest-foods").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var meal = btn.getAttribute("data-meal");
      var input = document.querySelector(".meal-desc-input[data-meal=\"" + meal + "\"]");
      var description = input ? input.value.trim() : "";
      if (!description) {
        alert("Describe the meal first (e.g. two eggs, toast, orange juice).");
        return;
      }
      btn.disabled = true;
      btn.textContent = "…";
      fetch(getParseMealApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description }),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || r.statusText); });
          return r.json();
        })
        .then(function (data) {
          var items = data.items || [];
          if (items.length === 0) {
            showUnmatched(meal, []);
            return Promise.resolve();
          }
          return loadFoodDatabase().then(function () {
            var mealData = getTodayMealEntries();
            var matched = [];
            var unmatched = [];
            return processAiItems(meal, items, mealData, matched, unmatched);
          }).then(function () {
            if (input) input.value = "";
          });
        })
        .catch(function (err) {
          alert("Could not get suggestions: " + (err.message || err));
          showUnmatched(meal, []);
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = "Analyze with AI";
        });
    });
  });

  // --- Recipes: add recipe placeholder ---
  const addRecipeBtn = document.getElementById("add-recipe-btn");
  if (addRecipeBtn) {
    addRecipeBtn.addEventListener("click", function () {
      alert("Add recipe form coming soon. Recipes will include ingredients and nickel per serving (µg + low/medium/high).");
    });
  }

  // --- External resources: add resource placeholder ---
  const addResourceBtn = document.getElementById("add-resource-btn");
  if (addResourceBtn) {
    addResourceBtn.addEventListener("click", function () {
      const url = prompt("Resource URL:");
      if (!url || !url.trim()) return;
      const desc = prompt("Short description:");
      const list = document.getElementById("resources-list");
      if (!list) return;
      const li = document.createElement("li");
      li.className = "resource-card card";
      li.innerHTML =
        '<a href="' +
        url.trim() +
        '" class="resource-link" target="_blank" rel="noopener">' +
        (url.length > 50 ? url.slice(0, 47) + "…" : url) +
        "</a>" +
        (desc && desc.trim()
          ? '<p class="resource-desc">' + desc.trim() + "</p>"
          : "");
      list.appendChild(li);
    });
  }
})();
