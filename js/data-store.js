/**
 * DataStore — abstraction layer over localStorage (guest) and Supabase (logged-in).
 *
 * Phase 1: localStorage only (same behavior as before).
 * Phase 3: adds Supabase cache-and-writeback when logged in.
 */
var DataStore = (function () {
  "use strict";

  var MEAL_ENTRIES_KEY = "nickeltrack-meal-entries";
  var RECIPES_KEY = "nickeltrack-recipes";
  var MEAL_PLAN_KEY = "nickeltrack-meal-plan";
  var DAILY_GOAL_KEY = "nickeltrack-daily-goal";
  var SERVING_UNITS_KEY = "nickeltrack-serving-units";
  var DAILY_GOAL_DEFAULT = 150;

  // --- Session state (set by auth module later) ---
  var _session = null;
  var _cache = null; // populated on login from Supabase

  function setSession(session) { _session = session; }
  function getSession() { return _session; }
  function isLoggedIn() { return _session !== null && _session.user !== null; }
  function userId() { return _session && _session.user ? _session.user.id : null; }

  function setCache(c) { _cache = c; }
  function getCache() { return _cache; }
  function clearCache() { _cache = null; }

  // --- Meal Entries ---

  function getStoredEntries() {
    if (_cache && _cache.mealEntries) return _cache.mealEntries;
    try {
      var raw = localStorage.getItem(MEAL_ENTRIES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function setStoredEntries(data) {
    if (_cache) {
      _cache.mealEntries = data;
      _writebackMealEntries(data);
      return;
    }
    try { localStorage.setItem(MEAL_ENTRIES_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function getMealEntriesForDate(date) {
    var all = getStoredEntries();
    if (!all[date]) all[date] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    return all[date];
  }

  function saveMealEntriesForDate(date, mealData) {
    var all = getStoredEntries();
    all[date] = mealData;
    setStoredEntries(all);
  }

  function getTotalNickelForDate(date) {
    var mealData = getMealEntriesForDate(date);
    var total = 0;
    ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
      (mealData[meal] || []).forEach(function (entry) {
        total += (entry.nickelUgPerServing || 0) * (entry.servings || 1);
      });
    });
    return Math.round(total * 10) / 10;
  }

  // --- Daily Goal ---

  function getStoredGoal() {
    if (_cache && _cache.preferences) return _cache.preferences.daily_goal_ug || DAILY_GOAL_DEFAULT;
    try {
      var v = localStorage.getItem(DAILY_GOAL_KEY);
      return v != null ? parseInt(v, 10) : DAILY_GOAL_DEFAULT;
    } catch (_) { return DAILY_GOAL_DEFAULT; }
  }

  function setStoredGoal(ug) {
    if (_cache && _cache.preferences) {
      _cache.preferences.daily_goal_ug = ug;
      _writebackPreferences();
      return;
    }
    try { localStorage.setItem(DAILY_GOAL_KEY, String(ug)); } catch (_) {}
  }

  // --- Serving Units ---

  function getServingUnits() {
    if (_cache && _cache.preferences) return _cache.preferences.serving_units || "us";
    try {
      var v = localStorage.getItem(SERVING_UNITS_KEY);
      return (v === "metric" || v === "us") ? v : "us";
    } catch (_) { return "us"; }
  }

  function setServingUnits(val) {
    var unit = val === "metric" ? "metric" : "us";
    if (_cache && _cache.preferences) {
      _cache.preferences.serving_units = unit;
      _writebackPreferences();
      return;
    }
    try { localStorage.setItem(SERVING_UNITS_KEY, unit); } catch (_) {}
  }

  // --- Recipes ---

  function getStoredRecipes() {
    if (_cache && _cache.recipes) return _cache.recipes;
    try {
      var raw = localStorage.getItem(RECIPES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function setStoredRecipes(recipes) {
    if (_cache) {
      _cache.recipes = recipes;
      _writebackRecipes(recipes);
      return;
    }
    try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes)); } catch (_) {}
  }

  function deleteRecipe(id) {
    setStoredRecipes(getStoredRecipes().filter(function (r) { return r.id !== id; }));
  }

  // --- Meal Plan ---

  function getStoredPlan() {
    if (_cache && _cache.mealPlan) return _cache.mealPlan;
    try {
      var raw = localStorage.getItem(MEAL_PLAN_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function setStoredPlan(plan) {
    if (_cache) {
      _cache.mealPlan = plan;
      _writebackMealPlan(plan);
      return;
    }
    try { localStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(plan)); } catch (_) {}
  }

  function getPlanForWeek(weekKey) {
    return getStoredPlan()[weekKey] || {};
  }

  function savePlanForWeek(weekKey, weekData) {
    var plan = getStoredPlan();
    plan[weekKey] = weekData;
    setStoredPlan(plan);
  }

  // --- Supabase writeback (delegates to NickelTrackAuth when available) ---
  function _writebackMealEntries(data) {
    if (typeof NickelTrackAuth !== "undefined" && NickelTrackAuth.writebackMealEntries) {
      NickelTrackAuth.writebackMealEntries(data);
    }
  }
  function _writebackPreferences() {
    if (typeof NickelTrackAuth !== "undefined" && NickelTrackAuth.writebackPreferences) {
      NickelTrackAuth.writebackPreferences();
    }
  }
  function _writebackRecipes(recipes) {
    if (typeof NickelTrackAuth !== "undefined" && NickelTrackAuth.writebackRecipes) {
      NickelTrackAuth.writebackRecipes(recipes);
    }
  }
  function _writebackMealPlan(plan) {
    if (typeof NickelTrackAuth !== "undefined" && NickelTrackAuth.writebackMealPlan) {
      NickelTrackAuth.writebackMealPlan(plan);
    }
  }

  // --- Local-only helpers for sync (Phase 4) ---
  function getLocalEntries() {
    try { var raw = localStorage.getItem(MEAL_ENTRIES_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (_) { return {}; }
  }
  function getLocalRecipes() {
    try { var raw = localStorage.getItem(RECIPES_KEY); return raw ? JSON.parse(raw) : []; }
    catch (_) { return []; }
  }
  function getLocalPlan() {
    try { var raw = localStorage.getItem(MEAL_PLAN_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (_) { return {}; }
  }
  function getLocalGoal() {
    try { var v = localStorage.getItem(DAILY_GOAL_KEY); return v != null ? parseInt(v, 10) : DAILY_GOAL_DEFAULT; }
    catch (_) { return DAILY_GOAL_DEFAULT; }
  }
  function getLocalUnits() {
    try { var v = localStorage.getItem(SERVING_UNITS_KEY); return (v === "metric" || v === "us") ? v : "us"; }
    catch (_) { return "us"; }
  }

  return {
    // Session
    setSession: setSession,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    userId: userId,
    setCache: setCache,
    getCache: getCache,
    clearCache: clearCache,
    // Meal entries
    getStoredEntries: getStoredEntries,
    setStoredEntries: setStoredEntries,
    getMealEntriesForDate: getMealEntriesForDate,
    saveMealEntriesForDate: saveMealEntriesForDate,
    getTotalNickelForDate: getTotalNickelForDate,
    // Goal
    getStoredGoal: getStoredGoal,
    setStoredGoal: setStoredGoal,
    DAILY_GOAL_DEFAULT: DAILY_GOAL_DEFAULT,
    // Units
    getServingUnits: getServingUnits,
    setServingUnits: setServingUnits,
    // Recipes
    getStoredRecipes: getStoredRecipes,
    setStoredRecipes: setStoredRecipes,
    deleteRecipe: deleteRecipe,
    // Meal plan
    getStoredPlan: getStoredPlan,
    setStoredPlan: setStoredPlan,
    getPlanForWeek: getPlanForWeek,
    savePlanForWeek: savePlanForWeek,
    // Local-only (for sync)
    getLocalEntries: getLocalEntries,
    getLocalRecipes: getLocalRecipes,
    getLocalPlan: getLocalPlan,
    getLocalGoal: getLocalGoal,
    getLocalUnits: getLocalUnits
  };
})();
