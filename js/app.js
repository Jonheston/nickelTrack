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
    var nameMatches = [];
    var categoryOnlyMatches = [];
    foods.forEach(function (f) {
      var name = (f.name_en || "").toLowerCase();
      var cat = (f.category || "").toLowerCase();
      if (name.indexOf(q) !== -1) {
        nameMatches.push(f);
      } else if (cat.indexOf(q) !== -1) {
        categoryOnlyMatches.push(f);
      }
    });
    return nameMatches.concat(categoryOnlyMatches);
  }

  /** Search by food name only (no category matching). Used for AI matching. */
  function searchFoodsByName(query) {
    var q = (query || "").trim().toLowerCase();
    var foods = getFoods();
    if (!q) return [];
    return foods.filter(function (f) {
      return (f.name_en || "").toLowerCase().indexOf(q) !== -1;
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

    // Use name-only search so category matches don't pollute AI scoring
    var foods = searchFoodsByName(name);
    if (foods.length === 0) {
      var withoutNumbers = name.replace(/\b\d+\s*/g, "").trim();
      if (withoutNumbers && withoutNumbers !== name) foods = searchFoodsByName(withoutNumbers);
    }
    if (foods.length === 0) {
      var firstWord = name.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 2) foods = searchFoodsByName(firstWord);
    }
    if (foods.length === 0) return { matches: [], confidence: 0, best: null };

    // Filter to whole-word matches to avoid "egg" matching "eggplant"
    var wholeWordMatches = foods.filter(function (f) {
      var fn = f.name_en || f.id;
      return wordRelevantToName(name, fn) ||
             wordRelevantToName(name.split(/\s+/)[0], fn);
    });
    if (wholeWordMatches.length > 0) foods = wholeWordMatches;

    // Sort by similarity so the best match is first
    foods.sort(function (a, b) {
      return nameSimilarity(name, b.name_en || b.id) - nameSimilarity(name, a.name_en || a.id);
    });

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
  function getServingUnits() { return DataStore.getServingUnits(); }
  function setServingUnits(val) { DataStore.setServingUnits(val); }
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
    return ["meal-tracking", "food-database", "recipes", "meal-planner", "analytics", "resources"].includes(hash)
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

  // Unit conversion constants (water-density approximations)
  var UNIT_TO_GRAMS = { serving: null, g: 1, oz: 28.35, cup: 240, tbsp: 15, tsp: 5 };
  var UNIT_LABELS = { serving: "serving", g: "g", oz: "oz", cup: "cup", tbsp: "tbsp", tsp: "tsp" };
  var UNIT_KEYS = ["serving", "g", "oz", "cup", "tbsp", "tsp"];

  /**
   * Convert user-entered amount + unit into a servings multiplier.
   * servingSizeG = the food's canonical serving_size_g from the database.
   */
  function computeServingsMultiplier(amount, unit, servingSizeG) {
    if (unit === "serving" || !servingSizeG || servingSizeG <= 0) {
      return amount; // direct multiplier
    }
    var gramsPerUnit = UNIT_TO_GRAMS[unit] || 1;
    var totalGrams = amount * gramsPerUnit;
    return totalGrams / servingSizeG;
  }

  /** Pick a sensible default unit based on serving_size_g. */
  function getDefaultUnit(servingSizeG) {
    if (servingSizeG == null || servingSizeG <= 0) return "serving";
    if (getServingUnits() === "metric") return "g";
    for (var i = 0; i < US_VOLUME_MAP.length; i++) {
      var diff = Math.abs(servingSizeG - US_VOLUME_MAP[i][0]);
      if (diff < 3 || diff <= US_VOLUME_MAP[i][0] * 0.15) {
        var g = US_VOLUME_MAP[i][0];
        if (g <= 5) return "tsp";
        if (g <= 15) return "tbsp";
        return "cup";
      }
    }
    return "serving";
  }

  /** Pick a sensible default amount for the given unit. */
  function getDefaultAmount(servingSizeG, unit) {
    if (unit === "serving") return 1;
    if (servingSizeG == null || servingSizeG <= 0) return 1;
    if (unit === "g") return Math.round(servingSizeG);
    var gramsPerUnit = UNIT_TO_GRAMS[unit] || 1;
    var amount = servingSizeG / gramsPerUnit;
    return Math.round(amount * 4) / 4; // quarter precision
  }

  /** Build the unit <option> elements for a given food. */
  function buildUnitOptions(servingSizeG, selectedUnit) {
    var servingLabel = "serving";
    if (servingSizeG != null && servingSizeG > 0) {
      var vol = formatServingSize(servingSizeG);
      if (vol) servingLabel = "serving (" + vol + ")";
    }
    return UNIT_KEYS.map(function (u) {
      var label = u === "serving" ? servingLabel : UNIT_LABELS[u];
      return '<option value="' + u + '"' + (selectedUnit === u ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join("");
  }

  function getTodayDate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = (d.getMonth() + 1);
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function formatLocalDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  var selectedDate = getTodayDate();

  function getStoredEntries() { return DataStore.getStoredEntries(); }
  function setStoredEntries(data) { DataStore.setStoredEntries(data); }
  function getMealEntriesForDate(date) { return DataStore.getMealEntriesForDate(date || getTodayDate()); }
  function saveMealEntriesForDate(date, mealData) { DataStore.saveMealEntriesForDate(date || getTodayDate(), mealData); }
  function getTotalNickelForDate(date) { return DataStore.getTotalNickelForDate(date); }

  function setSelectedDate(dateStr) {
    selectedDate = dateStr || getTodayDate();
    loadAndRenderAllMeals();
    renderCalendar();
    updateDateNavLabel();
  }

  function hasDataForDate(date) {
    var mealData = getMealEntriesForDate(date);
    return (mealData.breakfast && mealData.breakfast.length > 0) ||
      (mealData.lunch && mealData.lunch.length > 0) ||
      (mealData.dinner && mealData.dinner.length > 0) ||
      (mealData.snacks && mealData.snacks.length > 0);
  }

  function getDayColorClass(dateStr) {
    if (!hasDataForDate(dateStr)) return "cal-no-data";
    var total = getTotalNickelForDate(dateStr);
    var goal = getStoredGoal();
    if (total <= goal) return "cal-under";
    if (total <= goal * 1.25) return "cal-over";
    return "cal-way-over";
  }

  function goPrevMonth() {
    var d = new Date(selectedDate + "T12:00:00");
    d.setMonth(d.getMonth() - 1);
    setSelectedDate(formatLocalDate(d));
  }

  function goNextMonth() {
    var d = new Date(selectedDate + "T12:00:00");
    d.setMonth(d.getMonth() + 1);
    setSelectedDate(formatLocalDate(d));
  }

  function renderCalendar() {
    var wrap = document.getElementById("calendar-wrap");
    if (!wrap) return;
    var parts = selectedDate.split("-");
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var first = new Date(year, month, 1);
    var last = new Date(year, month + 1, 0);
    var startPad = first.getDay();
    var daysInMonth = last.getDate();
    var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var todayStr = getTodayDate();
    var html = "<div class=\"cal-month-nav\">";
    html += "<button type=\"button\" class=\"btn btn-secondary cal-month-btn\" id=\"cal-prev-month\" aria-label=\"Previous month\">←</button>";
    html += "<span class=\"cal-month-title\">" + monthNames[month] + " " + year + "</span>";
    html += "<button type=\"button\" class=\"btn btn-secondary cal-month-btn\" id=\"cal-next-month\" aria-label=\"Next month\">→</button>";
    html += "</div>";
    html += "<div class=\"cal-grid\"><span class=\"cal-dow\">Sun</span><span class=\"cal-dow\">Mon</span><span class=\"cal-dow\">Tue</span><span class=\"cal-dow\">Wed</span><span class=\"cal-dow\">Thu</span><span class=\"cal-dow\">Fri</span><span class=\"cal-dow\">Sat</span>";
    for (var i = 0; i < startPad; i++) html += "<span class=\"cal-day cal-empty\"></span>";
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = year + "-" + (month + 1 < 10 ? "0" : "") + (month + 1) + "-" + (d < 10 ? "0" : "") + d;
      var isFuture = dateStr > todayStr;
      if (isFuture) {
        html += "<span class=\"cal-day cal-future\">" + d + "</span>";
      } else {
        var colorClass = getDayColorClass(dateStr);
        var isSelected = dateStr === selectedDate ? " cal-selected" : "";
        html += "<button type=\"button\" class=\"cal-day " + colorClass + isSelected + "\" data-date=\"" + dateStr + "\">" + d + "</button>";
      }
    }
    html += "</div>";
    wrap.innerHTML = html;
    wrap.querySelectorAll(".cal-day[data-date]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSelectedDate(btn.getAttribute("data-date"));
      });
    });
    var prevBtn = document.getElementById("cal-prev-month");
    var nextBtn = document.getElementById("cal-next-month");
    if (prevBtn) prevBtn.addEventListener("click", goPrevMonth);
    if (nextBtn) nextBtn.addEventListener("click", goNextMonth);
  }

  function updateDateNavLabel() {
    var heading = document.getElementById("daily-summary-heading");
    var input = document.getElementById("meal-date-input");
    if (input) input.value = selectedDate;
    if (heading) {
      if (selectedDate === getTodayDate()) {
        heading.textContent = "Today's nickel";
      } else {
        var d = new Date(selectedDate + "T12:00:00");
        heading.textContent = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + "'s nickel";
      }
    }
  }

  function buildEntryFromFood(food) {
    var servingG = food.serving_size_g != null ? food.serving_size_g : (food.nickel_ug_per_100g != null ? 100 : null);
    var defaultUnit = getDefaultUnit(servingG);
    var defaultAmount = getDefaultAmount(servingG, defaultUnit);
    return {
      foodId: food.id,
      name_en: food.name_en || food.id,
      nickelUgPerServing: nickelUgForFood(food),
      servings: computeServingsMultiplier(defaultAmount, defaultUnit, servingG),
      nickel_band: food.nickel_band || null,
      serving_size_g: servingG,
      display_unit: defaultUnit,
      display_amount: defaultAmount,
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
    // Backward compat: old entries lack display_unit/display_amount
    var displayUnit = entry.display_unit || "serving";
    var displayAmount = entry.display_amount != null ? entry.display_amount : entry.servings;
    var unitOpts = buildUnitOptions(entry.serving_size_g, displayUnit);
    li.innerHTML =
      "<div class=\"meal-entry-info\">" +
        "<div class=\"meal-entry-name\">" +
          (bandId ? "<span class=\"band-badge band-" + bandId + "\">" + escapeHtml(bandLabel) + "</span> " : "") +
          escapeHtml(entry.name_en) +
        "</div>" +
        "<div class=\"meal-entry-meta\">" + total + " µg</div>" +
      "</div>" +
      "<div class=\"meal-entry-quantity\">" +
        "<input type=\"number\" class=\"quantity-amount-input\" id=\"qty-amt-" + meal + "-" + index + "\" value=\"" + displayAmount + "\" min=\"0.01\" step=\"0.25\" data-meal=\"" + escapeHtml(meal) + "\" data-index=\"" + index + "\" />" +
        "<select class=\"quantity-unit-select\" id=\"qty-unit-" + meal + "-" + index + "\" data-meal=\"" + escapeHtml(meal) + "\" data-index=\"" + index + "\">" + unitOpts + "</select>" +
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
        const mealData = getMealEntriesForDate(selectedDate);
        const arr = mealData[meal] || [];
        arr.splice(idx, 1);
        mealData[meal] = arr;
        saveMealEntriesForDate(selectedDate, mealData);
        renderMealList(meal, arr);
        recomputeDailyTotal();
        renderCalendar();
      });
    });
    // Quantity amount input change handler
    list.querySelectorAll(".quantity-amount-input").forEach(function (input) {
      input.addEventListener("change", function () {
        var idx = parseInt(input.getAttribute("data-index"), 10);
        var mealData = getMealEntriesForDate(selectedDate);
        var arr = mealData[meal] || [];
        if (!arr[idx]) return;
        var amount = parseFloat(input.value) || 0;
        if (amount < 0.01) { amount = 0.01; input.value = amount; }
        var unitSelect = list.querySelector('.quantity-unit-select[data-index="' + idx + '"]');
        var unit = unitSelect ? unitSelect.value : "serving";
        var servingSizeG = arr[idx].serving_size_g || 100;
        var newServings = computeServingsMultiplier(amount, unit, servingSizeG);
        arr[idx].servings = newServings;
        arr[idx].display_unit = unit;
        arr[idx].display_amount = amount;
        saveMealEntriesForDate(selectedDate, mealData);
        var li = list.querySelector('li[data-entry-index="' + idx + '"]');
        if (li) {
          var total = Math.round(arr[idx].nickelUgPerServing * newServings * 10) / 10;
          li.setAttribute("data-servings", String(newServings));
          li.setAttribute("data-nickel-total", String(total));
          var meta = li.querySelector(".meal-entry-meta");
          if (meta) meta.textContent = total + " µg";
        }
        recomputeDailyTotal();
        renderCalendar();
      });
    });
    // Unit dropdown change handler — auto-converts amount to maintain same total grams
    list.querySelectorAll(".quantity-unit-select").forEach(function (select) {
      select.addEventListener("change", function () {
        var idx = parseInt(select.getAttribute("data-index"), 10);
        var mealData = getMealEntriesForDate(selectedDate);
        var arr = mealData[meal] || [];
        if (!arr[idx]) return;
        var amountInput = list.querySelector('.quantity-amount-input[data-index="' + idx + '"]');
        var oldAmount = amountInput ? parseFloat(amountInput.value) || 1 : 1;
        var oldUnit = arr[idx].display_unit || "serving";
        var newUnit = select.value;
        var servingSizeG = arr[idx].serving_size_g || 100;
        // Convert old amount to grams, then to new unit
        var oldGrams;
        if (oldUnit === "serving") {
          oldGrams = oldAmount * servingSizeG;
        } else {
          oldGrams = oldAmount * (UNIT_TO_GRAMS[oldUnit] || 1);
        }
        var newAmount;
        if (newUnit === "serving") {
          newAmount = oldGrams / servingSizeG;
        } else {
          newAmount = oldGrams / (UNIT_TO_GRAMS[newUnit] || 1);
        }
        // Round nicely
        newAmount = Math.round(newAmount * 100) / 100;
        if (newAmount < 0.01) newAmount = 0.01;
        if (amountInput) amountInput.value = newAmount;
        var newServings = computeServingsMultiplier(newAmount, newUnit, servingSizeG);
        arr[idx].servings = newServings;
        arr[idx].display_unit = newUnit;
        arr[idx].display_amount = newAmount;
        saveMealEntriesForDate(selectedDate, mealData);
        var li = list.querySelector('li[data-entry-index="' + idx + '"]');
        if (li) {
          var total = Math.round(arr[idx].nickelUgPerServing * newServings * 10) / 10;
          li.setAttribute("data-servings", String(newServings));
          li.setAttribute("data-nickel-total", String(total));
          var meta = li.querySelector(".meal-entry-meta");
          if (meta) meta.textContent = total + " µg";
        }
        recomputeDailyTotal();
        renderCalendar();
      });
    });
  }

  function loadAndRenderAllMeals() {
    var mealData = getMealEntriesForDate(selectedDate);
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
        const mealData = getMealEntriesForDate(selectedDate);
        const arr = mealData[currentAddMeal] || [];
        arr.push(buildEntryFromFood(food));
        mealData[currentAddMeal] = arr;
        saveMealEntriesForDate(selectedDate, mealData);
        renderMealList(currentAddMeal, arr);
        recomputeDailyTotal();
        renderCalendar();
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
    if (sectionId === "recipes") { loadFoodDatabase().then(renderRecipes).catch(function () {}); }
    if (sectionId === "analytics" && typeof NickelTrackAnalytics !== "undefined") { NickelTrackAnalytics.refresh(); }
    if (sectionId === "meal-planner") {
      if (!currentPlanWeek) {
        currentPlanWeek = getCurrentWeekStr();
        var plannerWeekInput = document.getElementById("planner-week");
        if (plannerWeekInput) plannerWeekInput.value = currentPlanWeek;
      }
      loadFoodDatabase().then(function () { renderPlannerGrid(); }).catch(function () {});
    }
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

  function getStoredGoal() { return DataStore.getStoredGoal(); }
  function setStoredGoal(µg) { DataStore.setStoredGoal(µg); }

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
  updateDateNavLabel();
  renderCalendar();

  var mealDateInput = document.getElementById("meal-date-input");
  var datePrev = document.getElementById("date-prev");
  var dateNext = document.getElementById("date-next");
  if (mealDateInput) {
    mealDateInput.addEventListener("change", function () {
      if (mealDateInput.value) setSelectedDate(mealDateInput.value);
    });
  }
  if (datePrev) {
    datePrev.addEventListener("click", function () {
      var d = new Date(selectedDate + "T12:00:00");
      d.setDate(d.getDate() - 1);
      setSelectedDate(formatLocalDate(d));
    });
  }
  if (dateNext) {
    dateNext.addEventListener("click", function () {
      var d = new Date(selectedDate + "T12:00:00");
      d.setDate(d.getDate() + 1);
      setSelectedDate(formatLocalDate(d));
    });
  }

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
    egg: ["egg", "eggs", "hen egg"],
    eggs: ["egg", "eggs", "hen egg", "omelette"],
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
    "scrambled eggs": ["egg", "omelette", "scrambled"],
    omelette: ["egg", "omelette", "scrambled"],
    omelet: ["egg", "omelette", "scrambled"],
    "fried egg": ["egg", "hen egg", "pan-fried"],
    "boiled egg": ["egg", "eggs", "hard-boiled"],
    "hard boiled egg": ["egg", "eggs", "hard-boiled"],
    ham: ["ham", "pork", "meat"],
    hamburger: ["beef", "ground", "meat"],
    burger: ["beef", "ground", "patty"],
    fries: ["potato", "fried"],
    "french fries": ["potato", "fried"],
    pizza: ["pizza", "bread", "cheese"],
    sandwich: ["bread", "sandwich"],
    soup: ["soup", "broth"],
    apple: ["apple", "fruit"],
    banana: ["banana", "fruit"],
    orange: ["orange", "fruit", "citrus"],
    tomato: ["tomato", "tomatoes"],
    carrot: ["carrot", "carrots"],
    broccoli: ["broccoli", "vegetable"],
    spinach: ["spinach", "leafy"],
    avocado: ["avocado", "fruit"],
    shrimp: ["shrimp", "seafood"],
    salmon: ["salmon", "fish"],
    tuna: ["tuna", "fish"],
    oatmeal: ["oat", "cereal", "porridge"],
    pancake: ["pancake", "batter"],
    waffle: ["waffle", "batter"],
    noodles: ["noodle", "pasta"],
    chocolate: ["chocolate", "cocoa"],
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
        saveMealEntriesForDate(selectedDate, mealData);
        renderMealList(meal, arr);
        recomputeDailyTotal();
        showUnmatched(meal, unmatched);
        renderCalendar();
        return Promise.resolve();
      }
      var itemName = items[i++];
      var result = findMatchesWithConfidence(itemName);

      // High confidence: auto-accept
      if (result.confidence >= DISAMBIGUATION_THRESHOLD) {
        matched.push(result.best);
        return next();
      }

      // Low confidence or zero matches: try AI pipeline
      var candidates;
      if (result.matches.length > 0) {
        // We have name matches but low confidence — use them as AI candidates
        candidates = result.matches.slice(0, 25);
      } else {
        candidates = getCandidatesForNoMatch(itemName);
      }

      if (candidates.length === 0) {
        unmatched.push(itemName);
        return next();
      }

      return callPickFoodApi(itemName, candidates).then(function (chosen) {
        if (chosen) {
          matched.push(chosen);
        } else if (result.matches.length > 0) {
          // AI couldn't pick; show disambiguation with name matches
          return showDisambiguationModal(itemName, result.matches).then(function (selected) {
            if (selected) matched.push(selected);
            return next();
          });
        } else {
          unmatched.push(itemName);
        }
        return next();
      }).catch(function () {
        if (result.matches.length > 0) {
          return showDisambiguationModal(itemName, result.matches).then(function (selected) {
            if (selected) matched.push(selected);
            return next();
          });
        }
        unmatched.push(itemName);
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
            var mealData = getMealEntriesForDate(selectedDate);
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

  // --- Image recognition (photo → AI → identify foods) ---

  function getAnalyzeImageApiUrl() {
    if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
      return window.location.origin + "/api/analyze-image";
    }
    return "http://localhost:5000/api/analyze-image";
  }

  /** Reusable helper: add a matched food to a meal for the selected date. */
  function addFoodToMeal(meal, food) {
    if (!meal || !food) return;
    var mealData = getMealEntriesForDate(selectedDate);
    var arr = mealData[meal] || [];
    arr.push(buildEntryFromFood(food));
    mealData[meal] = arr;
    saveMealEntriesForDate(selectedDate, mealData);
    renderMealList(meal, arr);
    recomputeDailyTotal();
    renderCalendar();
  }

  /** Resize image client-side to keep base64 payload under Vercel limits. */
  function resizeImageIfNeeded(base64, maxWidth, callback) {
    var img = new Image();
    img.onload = function () {
      if (img.width <= maxWidth) { callback(base64); return; }
      var canvas = document.createElement("canvas");
      var scale = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = function () { callback(base64); };
    img.src = base64;
  }

  var imageInput = document.getElementById("image-food-input");
  var pendingImageMeal = null;

  document.querySelectorAll(".btn-image-food").forEach(function (btn) {
    btn.addEventListener("click", function () {
      pendingImageMeal = btn.getAttribute("data-meal");
      if (imageInput) {
        imageInput.value = "";
        imageInput.click();
      }
    });
  });

  if (imageInput) {
    imageInput.addEventListener("change", function () {
      if (!imageInput.files || !imageInput.files[0] || !pendingImageMeal) return;
      var file = imageInput.files[0];
      var meal = pendingImageMeal;
      pendingImageMeal = null;

      if (file.size > 20 * 1024 * 1024) {
        alert("Image is too large. Please use an image under 20 MB.");
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        resizeImageIfNeeded(reader.result, 1024, function (resized) {
          sendImageForAnalysis(meal, resized);
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function sendImageForAnalysis(meal, base64Image) {
    var btn = document.querySelector('.btn-image-food[data-meal="' + meal + '"]');
    if (btn) { btn.disabled = true; btn.textContent = "Analyzing..."; }

    fetch(getAnalyzeImageApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Image }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || r.statusText); });
        return r.json();
      })
      .then(function (data) {
        var items = data.items || [];
        if (items.length === 0) {
          alert("No foods were identified in the image.");
          return Promise.resolve();
        }
        return loadFoodDatabase().then(function () {
          var mealData = getMealEntriesForDate(selectedDate);
          var matched = [];
          var unmatched = [];
          return processAiItems(meal, items, mealData, matched, unmatched);
        });
      })
      .catch(function (err) {
        alert("Could not analyze image: " + (err.message || err));
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Photo"; }
      });
  }

  // --- Barcode scanning ---

  var barcodeModal = document.getElementById("barcode-modal");
  var barcodeReaderEl = document.getElementById("barcode-reader");
  var barcodeStatus = document.getElementById("barcode-status");
  var barcodeCancel = document.getElementById("barcode-cancel");
  var html5QrCode = null;
  var barcodeMeal = null;

  // Show barcode scan buttons only if camera is available
  function checkCameraAvailability() {
    if (typeof Html5Qrcode === "undefined") return;
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        var hasCamera = devices.some(function (d) { return d.kind === "videoinput"; });
        if (hasCamera) {
          document.querySelectorAll(".btn-barcode-scan").forEach(function (btn) {
            btn.hidden = false;
          });
        }
      }).catch(function () {});
    }
  }
  checkCameraAvailability();

  document.querySelectorAll(".btn-barcode-scan").forEach(function (btn) {
    btn.addEventListener("click", function () {
      barcodeMeal = btn.getAttribute("data-meal");
      openBarcodeScanner();
    });
  });

  function openBarcodeScanner() {
    if (!barcodeModal || !barcodeReaderEl || typeof Html5Qrcode === "undefined") return;
    barcodeModal.hidden = false;
    if (barcodeStatus) barcodeStatus.textContent = "Point your camera at a barcode...";

    html5QrCode = new Html5Qrcode("barcode-reader");
    html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        aspectRatio: 1.5
      },
      onBarcodeScanSuccess,
      function () {} // ignore scan failures (noise)
    ).catch(function (err) {
      if (barcodeStatus) barcodeStatus.textContent = "Camera access denied or not available.";
    });
  }

  function closeBarcodeScanner() {
    if (html5QrCode) {
      html5QrCode.stop().then(function () {
        html5QrCode.clear();
      }).catch(function () {});
      html5QrCode = null;
    }
    if (barcodeModal) barcodeModal.hidden = true;
    barcodeMeal = null;
  }

  if (barcodeCancel) barcodeCancel.addEventListener("click", closeBarcodeScanner);
  if (barcodeModal) {
    barcodeModal.addEventListener("click", function (e) {
      if (e.target === barcodeModal) closeBarcodeScanner();
    });
  }

  function onBarcodeScanSuccess(decodedText) {
    // Stop scanning immediately to prevent duplicate scans
    if (html5QrCode) {
      html5QrCode.stop().catch(function () {});
    }
    if (barcodeStatus) barcodeStatus.textContent = "Barcode: " + decodedText + ". Looking up product...";

    var barcode = decodedText.trim();
    var meal = barcodeMeal;

    // Look up on Open Food Facts (free, no API key needed)
    fetch("https://world.openfoodfacts.org/api/v0/product/" + encodeURIComponent(barcode) + ".json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.status !== 1 || !data.product) {
          if (barcodeStatus) barcodeStatus.textContent = "Product not found in Open Food Facts database.";
          setTimeout(closeBarcodeScanner, 2500);
          return;
        }

        var product = data.product;
        var productName = product.product_name || product.product_name_en || "Unknown product";
        if (barcodeStatus) barcodeStatus.textContent = "Found: " + productName + ". Matching to nickel database...";

        return loadFoodDatabase().then(function () {
          var result = findMatchesWithConfidence(productName);

          if (result.confidence >= DISAMBIGUATION_THRESHOLD && result.best) {
            addFoodToMeal(meal, result.best);
            closeBarcodeScanner();
            return;
          }

          if (result.matches.length > 0) {
            closeBarcodeScanner();
            return showDisambiguationModal(productName, result.matches).then(function (selected) {
              if (selected) addFoodToMeal(meal, selected);
            });
          }

          // Try AI pick-food as fallback — pass food objects (callPickFoodApi expects objects with name_en)
          var allFoods = getFoods();
          if (allFoods.length > 0) {
            var candidateFoods = allFoods.slice(0, 25);
            return callPickFoodApi(productName, candidateFoods).then(function (chosen) {
              if (chosen) { addFoodToMeal(meal, chosen); closeBarcodeScanner(); return; }
              if (barcodeStatus) barcodeStatus.textContent = "\"" + productName + "\" not found in nickel database.";
              setTimeout(closeBarcodeScanner, 3000);
            }).catch(function () {
              if (barcodeStatus) barcodeStatus.textContent = "\"" + productName + "\" not found in nickel database.";
              setTimeout(closeBarcodeScanner, 3000);
            });
          }

          if (barcodeStatus) barcodeStatus.textContent = "\"" + productName + "\" not found in nickel database.";
          setTimeout(closeBarcodeScanner, 3000);
        });
      })
      .catch(function (err) {
        if (barcodeStatus) barcodeStatus.textContent = "Lookup failed: " + (err.message || err);
        setTimeout(closeBarcodeScanner, 3000);
      });
  }

  // --- Recipes: full CRUD ---
  function getStoredRecipes() { return DataStore.getStoredRecipes(); }
  function setStoredRecipes(recipes) { DataStore.setStoredRecipes(recipes); }
  function deleteRecipe(id) { DataStore.deleteRecipe(id); }
  function getRecipeNickelTotal(recipe) {
    var total = 0;
    (recipe.ingredients || []).forEach(function (ing) {
      total += (ing.nickelUgPerServing || 0) * (ing.servings || 1);
    });
    return Math.round(total * 10) / 10;
  }
  function getRecipeNickelPerServing(recipe) {
    return Math.round((getRecipeNickelTotal(recipe) / (recipe.totalServings || 1)) * 10) / 10;
  }

  var recipeModalIngredients = [];
  var editingRecipeId = null;

  function renderRecipes() {
    var grid = document.getElementById("recipes-grid");
    if (!grid) return;
    var recipes = getStoredRecipes();
    grid.innerHTML = "";
    if (recipes.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-state card";
      empty.innerHTML = "<p>No recipes yet. Add your first recipe to see it here.</p>";
      grid.appendChild(empty);
      return;
    }
    recipes.forEach(function (recipe) {
      var card = document.createElement("div");
      card.className = "recipe-card card";
      var nickelPerServing = getRecipeNickelPerServing(recipe);
      var nickelTotal = getRecipeNickelTotal(recipe);
      var count = (recipe.ingredients || []).length;

      var header = document.createElement("div");
      header.className = "recipe-card-header";
      var title = document.createElement("h4");
      title.className = "recipe-card-title";
      title.textContent = recipe.name || "Untitled";
      header.appendChild(title);
      card.appendChild(header);

      var meta = document.createElement("div");
      meta.className = "recipe-card-meta";
      meta.textContent = count + " ingredient(s) · " + recipe.totalServings + " serving(s) · " +
        nickelPerServing + " \u00b5g Ni/serving · " + nickelTotal + " \u00b5g total";
      card.appendChild(meta);

      var ingList = document.createElement("ul");
      ingList.className = "recipe-ingredient-summary";
      (recipe.ingredients || []).forEach(function (ing) {
        var li = document.createElement("li");
        var ingNi = Math.round((ing.nickelUgPerServing || 0) * (ing.servings || 1) * 10) / 10;
        li.textContent = (ing.servings || 1) + "x " + (ing.name_en || ing.foodId) + " (" + ingNi + " \u00b5g)";
        ingList.appendChild(li);
      });
      card.appendChild(ingList);

      var actions = document.createElement("div");
      actions.className = "recipe-card-actions";
      var editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () { openRecipeModal(recipe); });
      var delBtn = document.createElement("button");
      delBtn.className = "btn btn-secondary";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        if (confirm("Delete \"" + (recipe.name || "Untitled") + "\"?")) {
          deleteRecipe(recipe.id);
          renderRecipes();
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  function openRecipeModal(existing) {
    var modal = document.getElementById("recipe-modal");
    var nameInput = document.getElementById("recipe-name");
    var servingsInput = document.getElementById("recipe-servings");
    var titleEl = document.getElementById("recipe-modal-title");
    if (!modal) return;
    if (existing) {
      editingRecipeId = existing.id;
      if (titleEl) titleEl.textContent = "Edit Recipe";
      if (nameInput) nameInput.value = existing.name || "";
      if (servingsInput) servingsInput.value = existing.totalServings || 1;
      recipeModalIngredients = (existing.ingredients || []).map(function (i) {
        return Object.assign({}, i);
      });
    } else {
      editingRecipeId = null;
      if (titleEl) titleEl.textContent = "Add Recipe";
      if (nameInput) nameInput.value = "";
      if (servingsInput) servingsInput.value = 1;
      recipeModalIngredients = [];
    }
    renderRecipeIngredients();
    updateRecipeNickelSummary();
    modal.hidden = false;
    if (nameInput) nameInput.focus();
  }

  function renderRecipeIngredients() {
    var list = document.getElementById("recipe-ingredients-list");
    if (!list) return;
    list.innerHTML = "";
    if (recipeModalIngredients.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No ingredients yet.";
      list.appendChild(hint);
      return;
    }
    recipeModalIngredients.forEach(function (ing, idx) {
      var li = document.createElement("li");
      li.className = "recipe-ingredient-row";
      var ingNi = Math.round((ing.nickelUgPerServing || 0) * (ing.servings || 1) * 10) / 10;
      var nameSpan = document.createElement("span");
      nameSpan.className = "recipe-ing-name";
      nameSpan.textContent = ing.name_en || ing.foodId;

      // Quantity controls: amount input + unit select
      var displayUnit = ing.display_unit || "serving";
      var displayAmount = ing.display_amount != null ? ing.display_amount : (ing.servings || 1);
      var servingSizeG = ing.serving_size_g || 100;

      var qtyWrap = document.createElement("div");
      qtyWrap.className = "meal-entry-quantity";

      var amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.className = "quantity-amount-input";
      amountInput.value = displayAmount;
      amountInput.min = "0.01";
      amountInput.step = "0.25";

      var unitSelect = document.createElement("select");
      unitSelect.className = "quantity-unit-select";
      unitSelect.innerHTML = buildUnitOptions(servingSizeG, displayUnit);

      amountInput.addEventListener("change", function () {
        var amount = parseFloat(amountInput.value) || 0;
        if (amount < 0.01) { amount = 0.01; amountInput.value = amount; }
        var unit = unitSelect.value;
        recipeModalIngredients[idx].servings = computeServingsMultiplier(amount, unit, servingSizeG);
        recipeModalIngredients[idx].display_unit = unit;
        recipeModalIngredients[idx].display_amount = amount;
        renderRecipeIngredients();
        updateRecipeNickelSummary();
      });

      unitSelect.addEventListener("change", function () {
        var oldAmount = parseFloat(amountInput.value) || 1;
        var oldUnit = ing.display_unit || "serving";
        var newUnit = unitSelect.value;
        var oldGrams = oldUnit === "serving" ? oldAmount * servingSizeG : oldAmount * (UNIT_TO_GRAMS[oldUnit] || 1);
        var newAmount = newUnit === "serving" ? oldGrams / servingSizeG : oldGrams / (UNIT_TO_GRAMS[newUnit] || 1);
        newAmount = Math.round(newAmount * 100) / 100;
        if (newAmount < 0.01) newAmount = 0.01;
        amountInput.value = newAmount;
        recipeModalIngredients[idx].servings = computeServingsMultiplier(newAmount, newUnit, servingSizeG);
        recipeModalIngredients[idx].display_unit = newUnit;
        recipeModalIngredients[idx].display_amount = newAmount;
        renderRecipeIngredients();
        updateRecipeNickelSummary();
      });

      qtyWrap.appendChild(amountInput);
      qtyWrap.appendChild(unitSelect);

      var nickelSpan = document.createElement("span");
      nickelSpan.className = "recipe-ing-nickel";
      nickelSpan.textContent = ingNi + " \u00b5g";
      var removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove-entry";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        recipeModalIngredients.splice(idx, 1);
        renderRecipeIngredients();
        updateRecipeNickelSummary();
      });
      li.appendChild(nameSpan);
      li.appendChild(qtyWrap);
      li.appendChild(nickelSpan);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  function updateRecipeNickelSummary() {
    var el = document.getElementById("recipe-nickel-summary");
    if (!el) return;
    var total = 0;
    recipeModalIngredients.forEach(function (ing) {
      total += (ing.nickelUgPerServing || 0) * (ing.servings || 1);
    });
    total = Math.round(total * 10) / 10;
    var servings = parseInt((document.getElementById("recipe-servings") || {}).value) || 1;
    var perServing = Math.round((total / servings) * 10) / 10;
    el.textContent = "Total: " + total + " \u00b5g \u00b7 Per serving: " + perServing + " \u00b5g (" + servings + " servings)";
  }

  function openRecipeIngredientModal() {
    var modal = document.getElementById("recipe-ingredient-modal");
    var searchInput = document.getElementById("recipe-ingredient-search");
    if (!modal) return;
    if (searchInput) searchInput.value = "";
    runRecipeIngredientSearch();
    modal.hidden = false;
    if (searchInput) searchInput.focus();
  }

  function runRecipeIngredientSearch() {
    var searchInput = document.getElementById("recipe-ingredient-search");
    var results = document.getElementById("recipe-ingredient-results");
    var query = searchInput ? searchInput.value : "";
    var foods = searchFoods(query);
    renderSearchResults(foods, results, {
      showAddButton: true,
      onAddClick: function (food) {
        recipeModalIngredients.push(buildEntryFromFood(food));
        renderRecipeIngredients();
        updateRecipeNickelSummary();
        var modal = document.getElementById("recipe-ingredient-modal");
        if (modal) modal.hidden = true;
      }
    });
  }

  // Wire up recipe UI
  (function () {
    var recipeIngSearch = document.getElementById("recipe-ingredient-search");
    if (recipeIngSearch) recipeIngSearch.addEventListener("input", runRecipeIngredientSearch);
    var recipeIngCancel = document.getElementById("recipe-ingredient-cancel");
    if (recipeIngCancel) recipeIngCancel.addEventListener("click", function () {
      var modal = document.getElementById("recipe-ingredient-modal");
      if (modal) modal.hidden = true;
    });
    var recipeSave = document.getElementById("recipe-save");
    if (recipeSave) recipeSave.addEventListener("click", function () {
      var name = (document.getElementById("recipe-name").value || "").trim();
      if (!name) { alert("Please enter a recipe name."); return; }
      if (recipeModalIngredients.length === 0) { alert("Add at least one ingredient."); return; }
      var totalServings = parseInt(document.getElementById("recipe-servings").value) || 1;
      var recipes = getStoredRecipes();
      if (editingRecipeId) {
        for (var j = 0; j < recipes.length; j++) {
          if (recipes[j].id === editingRecipeId) {
            recipes[j].name = name;
            recipes[j].ingredients = recipeModalIngredients;
            recipes[j].totalServings = totalServings;
            break;
          }
        }
      } else {
        recipes.push({ id: "recipe-" + Date.now(), name: name, ingredients: recipeModalIngredients, totalServings: totalServings, createdAt: new Date().toISOString() });
      }
      setStoredRecipes(recipes);
      var modal = document.getElementById("recipe-modal");
      if (modal) modal.hidden = true;
      renderRecipes();
    });
    var recipeCancel = document.getElementById("recipe-cancel");
    if (recipeCancel) recipeCancel.addEventListener("click", function () {
      var modal = document.getElementById("recipe-modal");
      if (modal) modal.hidden = true;
    });
    var recipeModal = document.getElementById("recipe-modal");
    if (recipeModal) recipeModal.addEventListener("click", function (e) {
      if (e.target === recipeModal) recipeModal.hidden = true;
    });
    var recipeIngModal = document.getElementById("recipe-ingredient-modal");
    if (recipeIngModal) recipeIngModal.addEventListener("click", function (e) {
      if (e.target === recipeIngModal) recipeIngModal.hidden = true;
    });
    var addIngBtn = document.getElementById("recipe-add-ingredient");
    if (addIngBtn) addIngBtn.addEventListener("click", function () {
      loadFoodDatabase().then(function () { openRecipeIngredientModal(); });
    });
    var addRecipeBtn = document.getElementById("add-recipe-btn");
    if (addRecipeBtn) addRecipeBtn.addEventListener("click", function () {
      loadFoodDatabase().then(function () { openRecipeModal(null); });
    });
    var servingsInput = document.getElementById("recipe-servings");
    if (servingsInput) servingsInput.addEventListener("input", updateRecipeNickelSummary);
  })();

  // --- Meal Planner ---
  var currentPlanWeek = null;

  function getStoredPlan() { return DataStore.getStoredPlan(); }
  function setStoredPlan(plan) { DataStore.setStoredPlan(plan); }
  function getPlanForWeek(weekKey) { return DataStore.getPlanForWeek(weekKey); }
  function savePlanForWeek(weekKey, weekData) { DataStore.savePlanForWeek(weekKey, weekData); }

  function getCurrentWeekStr() {
    var now = new Date();
    var dayOfWeek = now.getDay() || 7;
    var thursday = new Date(now);
    thursday.setDate(now.getDate() + 4 - dayOfWeek);
    var yearStart = new Date(thursday.getFullYear(), 0, 1);
    var weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    return thursday.getFullYear() + "-W" + (weekNo < 10 ? "0" : "") + weekNo;
  }

  function getWeekDates(weekStr) {
    var match = weekStr.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return [];
    var year = parseInt(match[1]);
    var week = parseInt(match[2]);
    var jan4 = new Date(year, 0, 4);
    var dayOfWeek = jan4.getDay() || 7;
    var monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(formatLocalDate(d));
    }
    return dates;
  }

  var PLAN_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var PLAN_MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snacks"];
  var plannerAddTarget = null; // { dateStr, meal }

  function renderPlannerGrid() {
    var grid = document.getElementById("planner-grid");
    if (!grid || !currentPlanWeek) return;
    grid.innerHTML = "";
    var weekDates = getWeekDates(currentPlanWeek);
    var weekData = getPlanForWeek(currentPlanWeek);

    weekDates.forEach(function (dateStr, dayIdx) {
      var dayCard = document.createElement("div");
      dayCard.className = "planner-day card";
      var dayHeader = document.createElement("div");
      dayHeader.className = "planner-day-header";
      var dayTitle = document.createElement("h4");
      dayTitle.textContent = PLAN_DAY_NAMES[dayIdx];
      var dayDate = document.createElement("span");
      dayDate.className = "planner-day-date";
      dayDate.textContent = dateStr;
      dayHeader.appendChild(dayTitle);
      dayHeader.appendChild(dayDate);
      dayCard.appendChild(dayHeader);

      var dayData = weekData[dateStr] || { breakfast: [], lunch: [], dinner: [], snacks: [] };
      var dayTotal = 0;

      PLAN_MEAL_SLOTS.forEach(function (meal) {
        var section = document.createElement("div");
        section.className = "planner-meal-section";
        var label = document.createElement("span");
        label.className = "planner-meal-label";
        label.textContent = mealLabels[meal] || meal;
        section.appendChild(label);

        var items = dayData[meal] || [];
        items.forEach(function (entry, idx) {
          var itemNi = (entry.nickelUgPerServing || 0) * (entry.servings || 1);
          dayTotal += itemNi;
          var itemEl = document.createElement("div");
          itemEl.className = "planner-item";
          var itemName = document.createElement("span");
          itemName.textContent = entry.name_en || entry.name || "?";
          var itemMeta = document.createElement("span");
          itemMeta.className = "planner-item-meta";
          itemMeta.textContent = Math.round(itemNi * 10) / 10 + " \u00b5g";
          var removeBtn = document.createElement("button");
          removeBtn.className = "btn-remove-entry";
          removeBtn.textContent = "\u00d7";
          removeBtn.addEventListener("click", function () {
            items.splice(idx, 1);
            dayData[meal] = items;
            weekData[dateStr] = dayData;
            savePlanForWeek(currentPlanWeek, weekData);
            renderPlannerGrid();
          });
          itemEl.appendChild(itemName);
          itemEl.appendChild(itemMeta);
          itemEl.appendChild(removeBtn);
          section.appendChild(itemEl);
        });

        var addBtn = document.createElement("button");
        addBtn.className = "btn btn-secondary planner-add-btn";
        addBtn.textContent = "+";
        addBtn.addEventListener("click", function () {
          openPlannerAddModal(dateStr, meal);
        });
        section.appendChild(addBtn);
        dayCard.appendChild(section);
      });

      var totalEl = document.createElement("div");
      totalEl.className = "planner-day-total";
      totalEl.textContent = "Daily total: " + Math.round(dayTotal * 10) / 10 + " \u00b5g";
      var goal = getStoredGoal();
      if (dayTotal > goal * 1.25) totalEl.classList.add("over-goal");
      else if (dayTotal > goal) totalEl.classList.add("near-goal");
      dayCard.appendChild(totalEl);
      grid.appendChild(dayCard);
    });
  }

  function openPlannerAddModal(dateStr, meal) {
    plannerAddTarget = { dateStr: dateStr, meal: meal };
    var modal = document.getElementById("planner-add-modal");
    var context = document.getElementById("planner-add-context");
    if (context) context.textContent = (mealLabels[meal] || meal) + " on " + dateStr;
    // Show foods tab by default
    showPlannerTab("foods");
    var searchInput = document.getElementById("planner-food-search");
    if (searchInput) { searchInput.value = ""; }
    runPlannerFoodSearch();
    renderPlannerRecipeList();
    if (modal) modal.hidden = false;
    if (searchInput) searchInput.focus();
  }

  function showPlannerTab(tab) {
    var foodsTab = document.getElementById("planner-foods-tab");
    var recipesTab = document.getElementById("planner-recipes-tab");
    if (foodsTab) foodsTab.hidden = tab !== "foods";
    if (recipesTab) recipesTab.hidden = tab !== "recipes";
    document.querySelectorAll(".planner-tab").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === tab);
    });
  }

  function addToPlan(entry) {
    if (!plannerAddTarget || !currentPlanWeek) return;
    var weekData = getPlanForWeek(currentPlanWeek);
    var dayData = weekData[plannerAddTarget.dateStr] || { breakfast: [], lunch: [], dinner: [], snacks: [] };
    var arr = dayData[plannerAddTarget.meal] || [];
    arr.push(entry);
    dayData[plannerAddTarget.meal] = arr;
    weekData[plannerAddTarget.dateStr] = dayData;
    savePlanForWeek(currentPlanWeek, weekData);
    var modal = document.getElementById("planner-add-modal");
    if (modal) modal.hidden = true;
    renderPlannerGrid();
  }

  function runPlannerFoodSearch() {
    var searchInput = document.getElementById("planner-food-search");
    var results = document.getElementById("planner-food-results");
    var query = searchInput ? searchInput.value : "";
    var foods = searchFoods(query);
    renderSearchResults(foods, results, {
      showAddButton: true,
      onAddClick: function (food) { addToPlan(buildEntryFromFood(food)); }
    });
  }

  function renderPlannerRecipeList() {
    var container = document.getElementById("planner-recipe-list");
    if (!container) return;
    container.innerHTML = "";
    var recipes = getStoredRecipes();
    if (recipes.length === 0) {
      container.appendChild(document.createTextNode("No recipes saved yet."));
      return;
    }
    recipes.forEach(function (recipe) {
      var div = document.createElement("div");
      div.className = "food-result card";
      div.setAttribute("role", "listitem");
      var nickelPerServing = getRecipeNickelPerServing(recipe);
      div.innerHTML =
        "<div class=\"food-result-name\">" + escapeHtml(recipe.name || "Untitled") + "</div>" +
        "<div class=\"food-result-meta\">" + nickelPerServing + " \u00b5g/serving (" + recipe.totalServings + " servings)</div>" +
        "<button type=\"button\" class=\"btn btn-primary btn-add-food\">Add</button>";
      div.querySelector(".btn-add-food").addEventListener("click", function () {
        addToPlan({ name_en: recipe.name, nickelUgPerServing: nickelPerServing, servings: 1, type: "recipe", recipeId: recipe.id });
      });
      container.appendChild(div);
    });
  }

  // Wire up planner UI
  (function () {
    var plannerWeekInput = document.getElementById("planner-week");
    var plannerPrev = document.getElementById("planner-prev-week");
    var plannerNext = document.getElementById("planner-next-week");
    if (plannerWeekInput) {
      plannerWeekInput.addEventListener("change", function () {
        if (plannerWeekInput.value) {
          currentPlanWeek = plannerWeekInput.value;
          renderPlannerGrid();
        }
      });
    }
    if (plannerPrev) plannerPrev.addEventListener("click", function () {
      if (!currentPlanWeek) return;
      var m = currentPlanWeek.match(/^(\d{4})-W(\d{2})$/);
      if (!m) return;
      var y = parseInt(m[1]); var w = parseInt(m[2]) - 1;
      if (w < 1) { y--; w = 52; }
      currentPlanWeek = y + "-W" + (w < 10 ? "0" : "") + w;
      if (plannerWeekInput) plannerWeekInput.value = currentPlanWeek;
      renderPlannerGrid();
    });
    if (plannerNext) plannerNext.addEventListener("click", function () {
      if (!currentPlanWeek) return;
      var m = currentPlanWeek.match(/^(\d{4})-W(\d{2})$/);
      if (!m) return;
      var y = parseInt(m[1]); var w = parseInt(m[2]) + 1;
      if (w > 52) { y++; w = 1; }
      currentPlanWeek = y + "-W" + (w < 10 ? "0" : "") + w;
      if (plannerWeekInput) plannerWeekInput.value = currentPlanWeek;
      renderPlannerGrid();
    });
    var plannerFoodSearch = document.getElementById("planner-food-search");
    if (plannerFoodSearch) plannerFoodSearch.addEventListener("input", runPlannerFoodSearch);
    var plannerAddCancel = document.getElementById("planner-add-cancel");
    if (plannerAddCancel) plannerAddCancel.addEventListener("click", function () {
      var modal = document.getElementById("planner-add-modal");
      if (modal) modal.hidden = true;
    });
    var plannerAddModal = document.getElementById("planner-add-modal");
    if (plannerAddModal) plannerAddModal.addEventListener("click", function (e) {
      if (e.target === plannerAddModal) plannerAddModal.hidden = true;
    });
    document.querySelectorAll(".planner-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showPlannerTab(btn.getAttribute("data-tab"));
      });
    });
  })();

  // --- External resources: add resource ---
  var addResourceBtn = document.getElementById("add-resource-btn");
  if (addResourceBtn) {
    addResourceBtn.addEventListener("click", function () {
      var url = prompt("Resource URL:");
      if (!url || !url.trim()) return;
      var trimmedUrl = url.trim();
      if (/^javascript:/i.test(trimmedUrl)) { alert("Invalid URL"); return; }
      if (!/^https?:\/\//i.test(trimmedUrl)) trimmedUrl = "https://" + trimmedUrl;
      var desc = prompt("Short description:");
      var list = document.getElementById("resources-list");
      if (!list) return;
      var li = document.createElement("li");
      li.className = "resource-card card";
      var a = document.createElement("a");
      a.href = trimmedUrl;
      a.className = "resource-link";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = trimmedUrl.length > 50 ? trimmedUrl.slice(0, 47) + "..." : trimmedUrl;
      li.appendChild(a);
      if (desc && desc.trim()) {
        var p = document.createElement("p");
        p.className = "resource-desc";
        p.textContent = desc.trim();
        li.appendChild(p);
      }
      list.appendChild(li);
    });
  }

  // --- Expose reRender for auth module ---
  function reRenderApp() {
    loadAndRenderAllMeals();
    renderGoal();
    updateDateNavLabel();
    renderCalendar();
    renderRecipes();
    if (currentPlanWeek) renderPlannerGrid();
    updateUnitsToggleActive();
    // Refresh analytics if visible
    if (typeof NickelTrackAnalytics !== "undefined" && NickelTrackAnalytics.refresh) {
      NickelTrackAnalytics.refresh();
    }
  }

  window.NickelTrackApp = { reRender: reRenderApp };
})();
