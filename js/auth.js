/**
 * Auth module for NickelTrack.
 * Handles login / signup / logout UI and Supabase session lifecycle.
 * On auth state change it updates DataStore session/cache and triggers app re-render.
 */
var NickelTrackAuth = (function () {
  "use strict";

  var sb = NickelTrackSupabase.client;

  // DOM refs (filled on init)
  var els = {};

  var isSignUpMode = false;
  var isForgotMode = false;
  var isUpdatePasswordMode = false;

  function init() {
    els.modal       = document.getElementById("auth-modal");
    els.form        = document.getElementById("auth-form");
    els.emailInput  = document.getElementById("auth-email-input");
    els.passInput   = document.getElementById("auth-password-input");
    els.error       = document.getElementById("auth-error");
    els.success     = document.getElementById("auth-success");
    els.submitBtn   = document.getElementById("auth-submit-btn");
    els.heading     = document.getElementById("auth-modal-title");
    els.toggleText  = document.getElementById("auth-toggle");
    els.toggleLink  = document.getElementById("auth-toggle-link");
    els.forgotWrap  = document.getElementById("auth-forgot");
    els.forgotLink  = document.getElementById("auth-forgot-link");
    els.emailFormLabel = document.querySelector('label[for="auth-email-input"]');
    els.passFormLabel  = document.querySelector('label[for="auth-password-input"]');
    els.cancelBtn   = document.getElementById("auth-modal-cancel");
    els.loginBtn    = document.getElementById("auth-login-btn");
    els.signupBtn   = document.getElementById("auth-signup-btn");
    els.logoutBtn   = document.getElementById("auth-logout-btn");
    els.guestBar    = document.getElementById("auth-guest");
    els.userBar     = document.getElementById("auth-user");
    els.emailLabel  = document.getElementById("auth-email");

    // Open modal buttons
    els.loginBtn.addEventListener("click", function () { openModal(false); });
    els.signupBtn.addEventListener("click", function () { openModal(true); });
    els.cancelBtn.addEventListener("click", closeModal);
    els.logoutBtn.addEventListener("click", logout);

    // Toggle between login / signup
    els.toggleLink.addEventListener("click", function (e) {
      e.preventDefault();
      openModal(!isSignUpMode);
    });

    // Forgot password link
    els.forgotLink.addEventListener("click", function (e) {
      e.preventDefault();
      openForgotMode();
    });

    // Form submit
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      handleSubmit();
    });

    // Close modal on overlay click
    els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) closeModal();
    });

    // Listen for auth state changes
    sb.auth.onAuthStateChange(function (event, session) {
      if (event === "PASSWORD_RECOVERY") {
        // User clicked the reset link in their email — show new-password form
        openUpdatePasswordMode();
        return;
      }
      onSessionChange(session);
    });

    // Check current session on load
    sb.auth.getSession().then(function (res) {
      onSessionChange(res.data.session);
    });
  }

  // --- Modal helpers ---

  function openModal(signUp) {
    isSignUpMode = !!signUp;
    isForgotMode = false;
    isUpdatePasswordMode = false;
    els.heading.textContent = isSignUpMode ? "Sign up" : "Log in";
    els.submitBtn.textContent = isSignUpMode ? "Sign up" : "Log in";
    els.toggleText.innerHTML = isSignUpMode
      ? 'Already have an account? <a href="#" id="auth-toggle-link">Log in</a>'
      : 'Don\'t have an account? <a href="#" id="auth-toggle-link">Sign up</a>';
    // Re-bind toggle link after innerHTML replace
    document.getElementById("auth-toggle-link").addEventListener("click", function (e) {
      e.preventDefault();
      openModal(!isSignUpMode);
    });
    els.passInput.setAttribute("autocomplete", isSignUpMode ? "new-password" : "current-password");
    // Show email + password fields, forgot link (login only), toggle text
    els.emailFormLabel.style.display = "";
    els.emailInput.style.display = "";
    els.passFormLabel.style.display = "";
    els.passInput.style.display = "";
    els.passInput.required = true;
    els.emailInput.required = true;
    els.submitBtn.hidden = false;
    els.forgotWrap.hidden = isSignUpMode;
    els.toggleText.hidden = false;
    els.cancelBtn.hidden = false;
    hideError();
    hideSuccess();
    els.modal.hidden = false;
    els.emailInput.focus();
  }

  function openForgotMode() {
    isForgotMode = true;
    isSignUpMode = false;
    isUpdatePasswordMode = false;
    els.heading.textContent = "Reset password";
    els.submitBtn.textContent = "Send reset link";
    els.submitBtn.disabled = false;
    // Show only email field
    els.emailFormLabel.style.display = "";
    els.emailInput.style.display = "";
    els.emailInput.required = true;
    // Hide password field
    els.passFormLabel.style.display = "none";
    els.passInput.style.display = "none";
    els.passInput.required = false;
    els.submitBtn.hidden = false;
    // Hide forgot link, show "Back to log in" in toggle area
    els.forgotWrap.hidden = true;
    els.toggleText.innerHTML = '<a href="#" id="auth-toggle-link">Back to log in</a>';
    els.toggleText.hidden = false;
    document.getElementById("auth-toggle-link").addEventListener("click", function (e) {
      e.preventDefault();
      openModal(false);
    });
    hideError();
    hideSuccess();
  }

  function openUpdatePasswordMode() {
    isUpdatePasswordMode = true;
    isForgotMode = false;
    isSignUpMode = false;
    els.heading.textContent = "Set new password";
    els.submitBtn.textContent = "Update password";
    els.submitBtn.disabled = false;
    // Hide email field, show only password field
    els.emailFormLabel.style.display = "none";
    els.emailInput.style.display = "none";
    els.emailInput.required = false;
    els.passFormLabel.style.display = "";
    els.passInput.style.display = "";
    els.passInput.required = true;
    els.passInput.setAttribute("autocomplete", "new-password");
    els.passInput.setAttribute("placeholder", "New password (min 6 characters)");
    // Hide forgot link and toggle text
    els.forgotWrap.hidden = true;
    els.toggleText.hidden = true;
    els.cancelBtn.hidden = true;
    hideError();
    hideSuccess();
    els.modal.hidden = false;
    els.passInput.focus();
  }

  function closeModal() {
    els.modal.hidden = true;
    els.form.reset();
    // Reset display styles
    els.emailFormLabel.style.display = "";
    els.emailInput.style.display = "";
    els.passFormLabel.style.display = "";
    els.passInput.style.display = "";
    els.submitBtn.hidden = false;
    els.passInput.required = true;
    els.emailInput.required = true;
    els.passInput.setAttribute("placeholder", "Password (min 6 characters)");
    isForgotMode = false;
    isUpdatePasswordMode = false;
    hideError();
    hideSuccess();
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
  }
  function hideError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }
  function showSuccess(msg) {
    els.success.textContent = msg;
    els.success.hidden = false;
  }
  function hideSuccess() {
    els.success.textContent = "";
    els.success.hidden = true;
  }

  // --- Auth actions ---

  function handleSubmit() {
    // Route to the correct handler based on mode
    if (isForgotMode) {
      handleForgotSubmit();
      return;
    }
    if (isUpdatePasswordMode) {
      handleUpdatePassword();
      return;
    }

    var email = (els.emailInput.value || "").trim();
    var pass  = els.passInput.value || "";
    if (!email || pass.length < 6) {
      showError("Please enter a valid email and a password of at least 6 characters.");
      return;
    }
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = isSignUpMode ? "Signing up..." : "Logging in...";

    var authPromise = isSignUpMode
      ? sb.auth.signUp({ email: email, password: pass })
      : sb.auth.signInWithPassword({ email: email, password: pass });

    authPromise.then(function (res) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = isSignUpMode ? "Sign up" : "Log in";
      if (res.error) {
        showError(res.error.message);
        return;
      }
      // If sign-up requires email confirmation the session may be null
      if (isSignUpMode && !res.data.session) {
        showError("Check your email for a confirmation link, then log in.");
        return;
      }
      closeModal();
    }).catch(function (err) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = isSignUpMode ? "Sign up" : "Log in";
      showError(err.message || "Something went wrong.");
    });
  }

  function handleForgotSubmit() {
    var email = (els.emailInput.value || "").trim();
    if (!email) {
      showError("Please enter your email address.");
      return;
    }
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "Sending...";
    hideError();

    sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    }).then(function (res) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Send reset link";
      if (res.error) {
        showError(res.error.message);
        return;
      }
      hideError();
      showSuccess("Check your email for a password reset link. You can close this dialog.");
      els.submitBtn.hidden = true;
    }).catch(function (err) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Send reset link";
      showError(err.message || "Something went wrong.");
    });
  }

  function handleUpdatePassword() {
    var pass = els.passInput.value || "";
    if (pass.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "Updating...";
    hideError();

    sb.auth.updateUser({ password: pass }).then(function (res) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Update password";
      if (res.error) {
        showError(res.error.message);
        return;
      }
      hideError();
      showSuccess("Password updated successfully!");
      setTimeout(function () {
        closeModal();
      }, 1500);
    }).catch(function (err) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Update password";
      showError(err.message || "Something went wrong.");
    });
  }

  function logout() {
    sb.auth.signOut().then(function () {
      DataStore.setSession(null);
      DataStore.clearCache();
      updateAuthUI(null);
      // Re-render the app from localStorage
      if (typeof window.NickelTrackApp !== "undefined" && window.NickelTrackApp.reRender) {
        window.NickelTrackApp.reRender();
      }
    });
  }

  // --- Session change handler ---

  function onSessionChange(session) {
    DataStore.setSession(session);
    updateAuthUI(session);

    if (session && session.user) {
      // Logged in: load data from Supabase into cache, then re-render
      loadAllFromSupabase(session.user.id).then(function (cache) {
        DataStore.setCache(cache);
        // Check if Supabase has data; if empty, sync from localStorage
        if (isCacheEmpty(cache)) {
          syncLocalToSupabase(session.user.id).then(function () {
            // Reload after sync
            return loadAllFromSupabase(session.user.id);
          }).then(function (freshCache) {
            DataStore.setCache(freshCache);
            reRenderApp();
          });
        } else {
          reRenderApp();
        }
      });
    } else {
      DataStore.clearCache();
      reRenderApp();
    }
  }

  function updateAuthUI(session) {
    if (session && session.user) {
      els.guestBar.hidden = true;
      els.userBar.hidden = false;
      els.emailLabel.textContent = session.user.email;
    } else {
      els.guestBar.hidden = false;
      els.userBar.hidden = true;
      els.emailLabel.textContent = "";
    }
  }

  function reRenderApp() {
    if (typeof window.NickelTrackApp !== "undefined" && window.NickelTrackApp.reRender) {
      window.NickelTrackApp.reRender();
    }
  }

  // --- Supabase data loading (Phase 3) ---

  function loadAllFromSupabase(uid) {
    return Promise.all([
      sb.from("user_preferences").select("*").eq("user_id", uid).maybeSingle(),
      sb.from("meal_entries").select("*").eq("user_id", uid).order("entry_date").order("sort_order"),
      sb.from("recipes").select("*, recipe_ingredients(*)").eq("user_id", uid),
      sb.from("meal_plan_entries").select("*").eq("user_id", uid)
    ]).then(function (results) {
      var prefs   = results[0].data || null;
      var entries = results[1].data || [];
      var recipes = results[2].data || [];
      var plans   = results[3].data || [];

      // Build cache objects matching DataStore format
      var cache = {
        preferences: {
          daily_goal_ug: prefs ? prefs.daily_goal_ug : DataStore.DAILY_GOAL_DEFAULT,
          serving_units: prefs ? prefs.serving_units : "us"
        },
        mealEntries: buildMealEntriesCache(entries),
        recipes: buildRecipesCache(recipes),
        mealPlan: buildMealPlanCache(plans)
      };
      return cache;
    });
  }

  function buildMealEntriesCache(rows) {
    // group rows by entry_date → meal → array of items
    var obj = {};
    rows.forEach(function (r) {
      var d = r.entry_date;
      if (!obj[d]) obj[d] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
      if (!obj[d][r.meal]) obj[d][r.meal] = [];
      obj[d][r.meal].push({
        food_id: r.food_id,
        name_en: r.name_en,
        nickelUgPerServing: r.nickel_ug_per_serving,
        servings: r.servings,
        nickelBand: r.nickel_band,
        servingSize_g: r.serving_size_g
      });
    });
    return obj;
  }

  function buildRecipesCache(rows) {
    return rows.map(function (r) {
      return {
        id: r.local_id,
        name: r.name,
        totalServings: r.total_servings,
        _supabaseId: r.id,
        ingredients: (r.recipe_ingredients || []).map(function (ing) {
          return {
            food_id: ing.food_id,
            name_en: ing.name_en,
            nickelUgPerServing: ing.nickel_ug_per_serving,
            servings: ing.servings,
            nickelBand: ing.nickel_band,
            servingSize_g: ing.serving_size_g
          };
        })
      };
    });
  }

  function buildMealPlanCache(rows) {
    var plan = {};
    rows.forEach(function (r) {
      var wk = r.week_key;
      if (!plan[wk]) plan[wk] = {};
      var d = r.entry_date;
      if (!plan[wk][d]) plan[wk][d] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
      if (!plan[wk][d][r.meal]) plan[wk][d][r.meal] = [];
      plan[wk][d][r.meal].push({
        name_en: r.name_en,
        nickelUgPerServing: r.nickel_ug_per_serving,
        servings: r.servings,
        type: r.entry_type,
        food_id: r.food_id,
        recipe_id: r.recipe_id
      });
    });
    return plan;
  }

  function isCacheEmpty(cache) {
    var hasEntries = Object.keys(cache.mealEntries).length > 0;
    var hasRecipes = cache.recipes.length > 0;
    var hasPlan = Object.keys(cache.mealPlan).length > 0;
    return !hasEntries && !hasRecipes && !hasPlan;
  }

  // --- Phase 4: Sync localStorage to Supabase ---

  function syncLocalToSupabase(uid) {
    var localEntries = DataStore.getLocalEntries();
    var localRecipes = DataStore.getLocalRecipes();
    var localPlan    = DataStore.getLocalPlan();
    var localGoal    = DataStore.getLocalGoal();
    var localUnits   = DataStore.getLocalUnits();

    var promises = [];

    // Preferences
    promises.push(
      sb.from("user_preferences").upsert({
        user_id: uid,
        daily_goal_ug: localGoal,
        serving_units: localUnits
      })
    );

    // Meal entries
    var entryRows = [];
    Object.keys(localEntries).forEach(function (date) {
      var dayData = localEntries[date];
      ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
        (dayData[meal] || []).forEach(function (item, idx) {
          entryRows.push({
            user_id: uid,
            entry_date: date,
            meal: meal,
            food_id: item.food_id || null,
            name_en: item.name_en || "Unknown",
            nickel_ug_per_serving: item.nickelUgPerServing || 0,
            servings: item.servings || 1,
            nickel_band: item.nickelBand || null,
            serving_size_g: item.servingSize_g || null,
            sort_order: idx
          });
        });
      });
    });
    if (entryRows.length > 0) {
      // Batch in chunks of 500
      for (var i = 0; i < entryRows.length; i += 500) {
        promises.push(sb.from("meal_entries").insert(entryRows.slice(i, i + 500)));
      }
    }

    // Recipes (each recipe then its ingredients)
    localRecipes.forEach(function (recipe) {
      var recipeId = crypto.randomUUID ? crypto.randomUUID() : ("r-" + Date.now() + "-" + Math.random().toString(36).slice(2));
      promises.push(
        sb.from("recipes").insert({
          id: recipeId,
          user_id: uid,
          local_id: recipe.id,
          name: recipe.name,
          total_servings: recipe.totalServings || 1
        }).then(function () {
          var ingRows = (recipe.ingredients || []).map(function (ing, idx) {
            return {
              recipe_id: recipeId,
              food_id: ing.food_id || null,
              name_en: ing.name_en || "Unknown",
              nickel_ug_per_serving: ing.nickelUgPerServing || 0,
              servings: ing.servings || 1,
              nickel_band: ing.nickelBand || null,
              serving_size_g: ing.servingSize_g || null,
              sort_order: idx
            };
          });
          if (ingRows.length > 0) {
            return sb.from("recipe_ingredients").insert(ingRows);
          }
        })
      );
    });

    // Meal plan entries
    var planRows = [];
    Object.keys(localPlan).forEach(function (weekKey) {
      var weekData = localPlan[weekKey];
      Object.keys(weekData).forEach(function (date) {
        var dayData = weekData[date];
        ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
          (dayData[meal] || []).forEach(function (item, idx) {
            planRows.push({
              user_id: uid,
              week_key: weekKey,
              entry_date: date,
              meal: meal,
              name_en: item.name_en || "Unknown",
              nickel_ug_per_serving: item.nickelUgPerServing || 0,
              servings: item.servings || 1,
              entry_type: item.type || "food",
              food_id: item.food_id || null,
              recipe_id: item.recipe_id || null,
              sort_order: idx
            });
          });
        });
      });
    });
    if (planRows.length > 0) {
      for (var j = 0; j < planRows.length; j += 500) {
        promises.push(sb.from("meal_plan_entries").insert(planRows.slice(j, j + 500)));
      }
    }

    return Promise.all(promises);
  }

  // --- Supabase writeback helpers (Phase 3) ---

  function writebackMealEntries(allEntries) {
    if (!DataStore.isLoggedIn()) return;
    var uid = DataStore.userId();
    // Delete all and re-insert (simple approach for MVP)
    sb.from("meal_entries").delete().eq("user_id", uid).then(function () {
      var rows = [];
      Object.keys(allEntries).forEach(function (date) {
        var dayData = allEntries[date];
        ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
          (dayData[meal] || []).forEach(function (item, idx) {
            rows.push({
              user_id: uid,
              entry_date: date,
              meal: meal,
              food_id: item.food_id || null,
              name_en: item.name_en || "Unknown",
              nickel_ug_per_serving: item.nickelUgPerServing || 0,
              servings: item.servings || 1,
              nickel_band: item.nickelBand || null,
              serving_size_g: item.servingSize_g || null,
              sort_order: idx
            });
          });
        });
      });
      if (rows.length > 0) {
        for (var i = 0; i < rows.length; i += 500) {
          sb.from("meal_entries").insert(rows.slice(i, i + 500));
        }
      }
    });
  }

  function writebackPreferences() {
    if (!DataStore.isLoggedIn()) return;
    var cache = DataStore.getCache();
    if (!cache || !cache.preferences) return;
    sb.from("user_preferences").upsert({
      user_id: DataStore.userId(),
      daily_goal_ug: cache.preferences.daily_goal_ug,
      serving_units: cache.preferences.serving_units
    });
  }

  function writebackRecipes(recipes) {
    if (!DataStore.isLoggedIn()) return;
    var uid = DataStore.userId();
    // Delete all and re-insert
    sb.from("recipes").delete().eq("user_id", uid).then(function () {
      recipes.forEach(function (recipe) {
        var recipeId = recipe._supabaseId || (crypto.randomUUID ? crypto.randomUUID() : ("r-" + Date.now() + "-" + Math.random().toString(36).slice(2)));
        sb.from("recipes").insert({
          id: recipeId,
          user_id: uid,
          local_id: recipe.id,
          name: recipe.name,
          total_servings: recipe.totalServings || 1
        }).then(function () {
          var ingRows = (recipe.ingredients || []).map(function (ing, idx) {
            return {
              recipe_id: recipeId,
              food_id: ing.food_id || null,
              name_en: ing.name_en || "Unknown",
              nickel_ug_per_serving: ing.nickelUgPerServing || 0,
              servings: ing.servings || 1,
              nickel_band: ing.nickelBand || null,
              serving_size_g: ing.servingSize_g || null,
              sort_order: idx
            };
          });
          if (ingRows.length > 0) {
            sb.from("recipe_ingredients").insert(ingRows);
          }
        });
      });
    });
  }

  function writebackMealPlan(plan) {
    if (!DataStore.isLoggedIn()) return;
    var uid = DataStore.userId();
    sb.from("meal_plan_entries").delete().eq("user_id", uid).then(function () {
      var rows = [];
      Object.keys(plan).forEach(function (weekKey) {
        var weekData = plan[weekKey];
        Object.keys(weekData).forEach(function (date) {
          var dayData = weekData[date];
          ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
            (dayData[meal] || []).forEach(function (item, idx) {
              rows.push({
                user_id: uid,
                week_key: weekKey,
                entry_date: date,
                meal: meal,
                name_en: item.name_en || "Unknown",
                nickel_ug_per_serving: item.nickelUgPerServing || 0,
                servings: item.servings || 1,
                entry_type: item.type || "food",
                food_id: item.food_id || null,
                recipe_id: item.recipe_id || null,
                sort_order: idx
              });
            });
          });
        });
      });
      if (rows.length > 0) {
        for (var i = 0; i < rows.length; i += 500) {
          sb.from("meal_plan_entries").insert(rows.slice(i, i + 500));
        }
      }
    });
  }

  // Init when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    writebackMealEntries: writebackMealEntries,
    writebackPreferences: writebackPreferences,
    writebackRecipes: writebackRecipes,
    writebackMealPlan: writebackMealPlan
  };
})();
