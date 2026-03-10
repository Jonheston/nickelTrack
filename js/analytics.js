/**
 * Analytics module for NickelTrack.
 * Computes stats and renders Chart.js charts from DataStore data.
 */
var NickelTrackAnalytics = (function () {
  "use strict";

  var currentRange = 30; // days
  var dailyChart = null;
  var mealChart = null;

  function init() {
    // Range buttons
    document.querySelectorAll(".analytics-range-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".analytics-range-btn").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        currentRange = parseInt(btn.getAttribute("data-range")) || 30;
        refresh();
      });
    });
  }

  function refresh() {
    var entries = DataStore.getStoredEntries();
    var goal = DataStore.getStoredGoal();

    // Build array of dates in range
    var dates = [];
    var today = new Date();
    for (var i = currentRange - 1; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      dates.push(formatDate(d));
    }

    // Daily totals
    var dailyTotals = dates.map(function (date) {
      return DataStore.getTotalNickelForDate(date);
    });

    renderDailyChart(dates, dailyTotals, goal);
    renderGoalAdherence(dailyTotals, goal);
    renderMealBreakdown(entries, dates);
    renderTopFoods(entries, dates);
  }

  function formatDate(d) {
    var y = d.getFullYear();
    var m = (d.getMonth() + 1);
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function formatShortDate(dateStr) {
    var parts = dateStr.split("-");
    return parseInt(parts[1]) + "/" + parseInt(parts[2]);
  }

  // --- Daily Nickel Intake chart ---
  function renderDailyChart(dates, totals, goal) {
    var canvas = document.getElementById("chart-daily-nickel");
    if (!canvas) return;

    var labels = dates.map(formatShortDate);
    var colors = totals.map(function (v) {
      if (v === 0) return "#e7e5e4";
      if (v <= goal) return "#22c55e";
      if (v <= goal * 1.25) return "#eab308";
      return "#dc2626";
    });

    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Nickel (\u00b5g)",
          data: totals,
          backgroundColor: colors,
          borderRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          annotation: undefined
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "\u00b5g nickel" }
          },
          x: {
            ticks: {
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 15
            }
          }
        }
      },
      plugins: [{
        id: "goalLine",
        afterDraw: function (chart) {
          var yScale = chart.scales.y;
          var ctx = chart.ctx;
          var yPixel = yScale.getPixelForValue(goal);
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "#0d9488";
          ctx.lineWidth = 2;
          ctx.moveTo(chart.chartArea.left, yPixel);
          ctx.lineTo(chart.chartArea.right, yPixel);
          ctx.stroke();
          ctx.fillStyle = "#0d9488";
          ctx.font = "12px sans-serif";
          ctx.fillText("Goal: " + goal + "\u00b5g", chart.chartArea.left + 4, yPixel - 6);
          ctx.restore();
        }
      }]
    });
  }

  // --- Goal Adherence stats ---
  function renderGoalAdherence(totals, goal) {
    var el = document.getElementById("goal-adherence-stats");
    if (!el) return;

    var daysWithData = 0;
    var under = 0;
    var near = 0;
    var over = 0;

    totals.forEach(function (v) {
      if (v > 0) {
        daysWithData++;
        if (v <= goal) under++;
        else if (v <= goal * 1.25) near++;
        else over++;
      }
    });

    var pct = daysWithData > 0 ? Math.round((under / daysWithData) * 100) : 0;
    el.innerHTML =
      "<div class=\"adherence-row\">" +
        "<span class=\"adherence-stat adherence-under\">" + under + " days</span> under goal" +
      "</div>" +
      "<div class=\"adherence-row\">" +
        "<span class=\"adherence-stat adherence-near\">" + near + " days</span> near goal (within 25%)" +
      "</div>" +
      "<div class=\"adherence-row\">" +
        "<span class=\"adherence-stat adherence-over\">" + over + " days</span> over goal" +
      "</div>" +
      "<div class=\"adherence-row adherence-summary\">" +
        "<strong>" + pct + "%</strong> of tracked days within goal (" + daysWithData + " days tracked)" +
      "</div>";
  }

  // --- Nickel by Meal chart ---
  function renderMealBreakdown(entries, dates) {
    var canvas = document.getElementById("chart-nickel-by-meal");
    if (!canvas) return;

    var meals = ["breakfast", "lunch", "dinner", "snacks"];
    var mealTotals = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };

    dates.forEach(function (date) {
      var dayData = entries[date];
      if (!dayData) return;
      meals.forEach(function (meal) {
        (dayData[meal] || []).forEach(function (entry) {
          mealTotals[meal] += (entry.nickelUgPerServing || 0) * (entry.servings || 1);
        });
      });
    });

    var mealColors = ["#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899"];

    if (mealChart) mealChart.destroy();
    mealChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Breakfast", "Lunch", "Dinner", "Snacks"],
        datasets: [{
          data: [
            Math.round(mealTotals.breakfast * 10) / 10,
            Math.round(mealTotals.lunch * 10) / 10,
            Math.round(mealTotals.dinner * 10) / 10,
            Math.round(mealTotals.snacks * 10) / 10
          ],
          backgroundColor: mealColors,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" }
        }
      }
    });
  }

  // --- Top Foods ---
  function renderTopFoods(entries, dates) {
    var el = document.getElementById("top-foods-list");
    if (!el) return;

    var foodMap = {}; // name_en → { count, totalNickel }
    dates.forEach(function (date) {
      var dayData = entries[date];
      if (!dayData) return;
      ["breakfast", "lunch", "dinner", "snacks"].forEach(function (meal) {
        (dayData[meal] || []).forEach(function (entry) {
          var name = entry.name_en || "Unknown";
          if (!foodMap[name]) foodMap[name] = { count: 0, totalNickel: 0 };
          foodMap[name].count++;
          foodMap[name].totalNickel += (entry.nickelUgPerServing || 0) * (entry.servings || 1);
        });
      });
    });

    // Sort by frequency desc
    var sorted = Object.keys(foodMap).map(function (name) {
      return { name: name, count: foodMap[name].count, totalNickel: foodMap[name].totalNickel };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    el.innerHTML = "";
    if (sorted.length === 0) {
      el.innerHTML = "<li class=\"empty-hint\">No data for this period.</li>";
      return;
    }
    sorted.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "top-food-item";
      li.innerHTML =
        "<span class=\"top-food-name\">" + escapeHtml(item.name) + "</span>" +
        "<span class=\"top-food-meta\">" + item.count + "x &middot; " + Math.round(item.totalNickel * 10) / 10 + " \u00b5g total</span>";
      el.appendChild(li);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Init when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { refresh: refresh };
})();
