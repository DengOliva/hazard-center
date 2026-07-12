(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function api(url) {
    var r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function yearStartISO() {
    return new Date().getFullYear() + "-01-01";
  }

  var currentStart = yearStartISO();
  var currentEnd = todayISO();

  function dateParams() {
    return "start=" + encodeURIComponent(currentStart) + "&end=" + encodeURIComponent(currentEnd);
  }

  // === Cards ===

  function renderCards(containerId, items) {
    var container = $(containerId);
    if (!container) return;
    container.innerHTML = items.map(function (item) {
      var total = item.total || 0;
      var cls = total > 0 ? " highlight" : "";
      return '<div class="stat-card' + cls + '">' +
        '<div class="card-label">' + esc(item.name) + '</div>' +
        '<div class="card-value">' + total + '</div>' +
        '<div class="card-detail">累计 ' + total + ' 条</div>' +
        '</div>';
    }).join("");
  }

  function renderCardsDynamic(containerId, items) {
    var container = $(containerId);
    if (!container) return;
    container.innerHTML = items.map(function (item) {
      var cls = item.count > 0 ? " highlight" : "";
      return '<div class="stat-card' + cls + '">' +
        '<div class="card-label">' + esc(item.name) + '</div>' +
        '<div class="card-value">' + item.count + '</div>' +
        '<div class="card-detail">累计 ' + item.count + ' 条</div>' +
        '</div>';
    }).join("") || '<div class="stat-card"><div class="card-label">暂无数据</div><div class="card-value">0</div></div>';
  }

  // === Line chart ===

  function drawLineChart(canvasId, datasets, yMin, yMax) {
    var canvas = $(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var w = rect.width;
    var h = 260;
    if (w < 10) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);

    var pad = { top: 16, right: 24, bottom: 32, left: 48 };
    var pw = w - pad.left - pad.right;
    var ph = h - pad.top - pad.bottom;
    if (pw <= 0 || ph <= 0) return;

    var range = yMax - yMin || 10;
    var months = datasets[0].data.length;
    function x(i) { return pad.left + (i / (months - 1 || 1)) * pw; }
    function y(v) { return pad.top + ph - ((v - yMin) / range) * ph; }

    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    for (var s = 0; s <= 5; s++) {
      var gy = pad.top + (s / 5) * ph;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke();
      var val = yMin + ((5 - s) / 5) * range;
      ctx.fillStyle = "#999"; ctx.font = "11px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(Math.round(val), pad.left - 8, gy + 4);
    }

    ctx.textAlign = "center"; ctx.fillStyle = "#999";
    for (var i = 0; i < months; i++) {
      var lbl = datasets[0].labels[i];
      if (lbl.length > 3) lbl = lbl.replace("月", "");
      ctx.fillText(lbl, x(i), h - pad.bottom + 16);
    }

    datasets.forEach(function (ds) {
      ctx.strokeStyle = ds.color; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
      ctx.beginPath();
      for (var i = 0; i < ds.data.length; i++) {
        var px = x(i), py = y(ds.data[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = ds.color;
      for (var i = 0; i < ds.data.length; i++) {
        ctx.beginPath(); ctx.arc(x(i), y(ds.data[i]), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  var chartsDrawn = false;
  var cachedScores = null;

  function drawCharts() {
    if (chartsDrawn || !cachedScores) return;
    var box = document.querySelector(".chart-box");
    if (!box || box.getBoundingClientRect().width < 10) return;

    var star5 = cachedScores.star5_2025 || [];
    var star6 = cachedScores.star5_2026 || [];
    var allS = star5.concat(star6);
    if (allS.length) {
      var smin = Math.floor(Math.min.apply(null, allS.map(function (d) { return d.score; })) - 2);
      var smax = Math.ceil(Math.max.apply(null, allS.map(function (d) { return d.score; })) + 1);
      drawLineChart("chart-star5", [
        { labels: star5.map(function (d) { return d.month; }), data: star5.map(function (d) { return d.score; }), color: "#e6a23c" },
        { labels: star6.map(function (d) { return d.month; }), data: star6.map(function (d) { return d.score; }), color: "#c84d4d" }
      ], smin, smax);
    }

    var aq5 = cachedScores.aqhb_2025 || [];
    var aq6 = cachedScores.aqhb_2026 || [];
    var allA = aq5.concat(aq6);
    if (allA.length) {
      var amin = Math.floor(Math.min.apply(null, allA.map(function (d) { return d.score; })) - 2);
      var amax = Math.ceil(Math.max.apply(null, allA.map(function (d) { return d.score; })) + 1);
      drawLineChart("chart-aqhb", [
        { labels: aq5.map(function (d) { return d.month; }), data: aq5.map(function (d) { return d.score; }), color: "#087b68" },
        { labels: aq6.map(function (d) { return d.month; }), data: aq6.map(function (d) { return d.score; }), color: "#409eff" }
      ], amin, amax);
    }
    chartsDrawn = true;
  }

  var globalSubBarData = [];
  var globalDeptBarData = [];

  // === Type stats (section 四) ===

  var TYPE_COLORS = [
    "#c84d4d", "#409eff", "#e6a23c", "#087b68", "#8b5cf6", "#f97316",
    "#06b6d4", "#ec4899", "#84cc16", "#f43f5e", "#6366f1", "#14b8a6"
  ];

  function drawDonutChart(canvasId, items) {
    var canvas = $(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w = parent.getBoundingClientRect().width;
    var h = 230;
    if (w < 10) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);

    var cx = w / 2, cy = h / 2, r = Math.min(cx, cy) - 20;
    if (r < 20) return;
    var total = items.reduce(function (s, it) { return s + it.count; }, 0);
    if (total === 0) {
      ctx.fillStyle = "#999"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("暂无数据", cx, cy);
      return;
    }

    var angle = -Math.PI / 2;
    items.forEach(function (item, i) {
      var slice = (item.count / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = TYPE_COLORS[i % TYPE_COLORS.length];
      ctx.fill();
      angle += slice;
    });

    // Center hole
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.fillStyle = "#333"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("总计", cx, cy - 4);
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(total, cx, cy + 18);

    // Legend
    var legend = document.getElementById(canvasId.replace("chart-", "") + "-legend");
    if (legend) {
      legend.innerHTML = items.slice(0, 8).map(function (item, i) {
        return '<span class="legend-item"><i style="background:' + TYPE_COLORS[i % TYPE_COLORS.length] + '"></i>' +
          esc(item.name) + " " + item.count + "</span>";
      }).join("");
    }
  }

  function drawHBarChart(canvasId, items, maxItems) {
    var canvas = $(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w = parent.getBoundingClientRect().width;
    maxItems = maxItems || 10;
    var barH = 22, gap = 6, topPad = 4, leftPad = 80, rightPad = 50, bottomPad = 4;
    var n = Math.min(items.length, maxItems);
    var h = topPad + (barH + gap) * n + bottomPad;
    if (w < 10 || n === 0 || h < 40) {
      canvas.width = w * dpr;
      canvas.height = 60 * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = "60px";
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#999"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("暂无数据", w / 2, 30);
      return;
    }
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);

    var topItems = items.slice(0, maxItems);
    var maxVal = topItems[0].count || 1;
    var barAreaW = w - leftPad - rightPad;

    topItems.forEach(function (item, i) {
      var y = topPad + i * (barH + gap);
      var bw = (item.count / maxVal) * barAreaW;
      if (bw < 2) bw = 2;

      // Label
      ctx.fillStyle = "#333"; ctx.font = "12px sans-serif"; ctx.textAlign = "right";
      var label = item.name;
      if (label.length > 5) label = label.substring(0, 5);
      ctx.fillText(label, leftPad - 8, y + barH - 6);

      // Bar
      ctx.fillStyle = TYPE_COLORS[i % TYPE_COLORS.length];
      ctx.fillRect(leftPad, y, bw, barH);

      // Value
      ctx.fillStyle = "#333"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(item.count, leftPad + bw + 6, y + barH - 6);
    });
  }

  var typeChartsDrawn = false;

  async function refreshTypeStats() {
    var catVal = ($("type-cat-filter") && $("type-cat-filter").value) || "";
    var typeVal = ($("type-name-filter") && $("type-name-filter").value) || "";
    var params = "?" + dateParams();
    if (catVal) params += "&category=" + encodeURIComponent(catVal);
    if (typeVal) params += "&type=" + encodeURIComponent(typeVal);

    var data = await api("/api/alert/type-stats" + params);

    if (typeVal) {
      // Drilldown: show dept/sub distribution
      drawDonutChart("chart-type-pie", data.dept_counts || []);
      drawHBarChart("chart-type-bar", data.dept_counts || []);
      document.querySelector("#sec-type-analysis .chart-box:first-of-type h3").textContent = typeVal + " 部门分布";
      document.querySelector("#sec-type-analysis .chart-box:last-of-type h3").textContent = typeVal + " 部门排行";
    } else {
      drawDonutChart("chart-type-pie", data.type_counts || []);
      drawHBarChart("chart-type-bar", data.type_counts || []);
      document.querySelector("#sec-type-analysis .chart-box:first-of-type h3").textContent = "预警类型占比";
      document.querySelector("#sec-type-analysis .chart-box:last-of-type h3").textContent = "预警类型排行";
    }
    typeChartsDrawn = true;
  }

  function buildTypeNameFilter() {
    var sel = $("type-name-filter");
    if (!sel) return;
    var currentVal = sel.value;
    sel.innerHTML = '<option value="">全部类型</option>';
    var allTypes = EXT_TYPE_ORDER.concat(INT_TYPE_ORDER.filter(function (t) { return EXT_TYPE_ORDER.indexOf(t) < 0; }));
    allTypes.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  }

  async function refreshSubData() {
    var subVal = ($("sub-filter") && $("sub-filter").value) || "";
    var params = "?" + dateParams();
    if (subVal) params += "&sub=" + encodeURIComponent(subVal);
    var data = await api("/api/alert/subcontractors" + params);
    globalSubBarData = data.bar_data || [];
    renderCardsDynamic("sub-ext-cards", data.external_types || []);
    renderCardsDynamic("sub-int-cards", data.internal_types || []);
  }

  async function refreshDeptData() {
    var deptVal = ($("dept-filter") && $("dept-filter").value) || "";
    var params = "?" + dateParams();
    if (deptVal) params += "&dept=" + encodeURIComponent(deptVal);
    var data = await api("/api/alert/departments" + params);
    globalDeptBarData = data.bar_data || [];
    renderCardsDynamic("dept-ext-cards", data.external_types || []);
    renderCardsDynamic("dept-int-cards", data.internal_types || []);
  }

  // === Import dialog ===

  function showImportDialog() {
    var dlg = $("import-dialog");
    if (!dlg) return;
    dlg.showModal();
    $("import-file").value = "";
    var st = $("import-status");
    st.textContent = "";
    st.className = "dialog-status";
    $("btn-upload").disabled = true;
  }

  async function doImport() {
    var file = $("import-file").files[0];
    if (!file) return;
    var st = $("import-status");
    st.textContent = "正在上传解析...";
    st.className = "dialog-status";
    $("btn-upload").disabled = true;
    var fd = new FormData();
    fd.append("file", file);
    try {
      var r = await fetch("/api/alert/import", { method: "POST", body: fd });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || "上传失败");
      st.textContent = "导入成功！外部" + data.external_count + "项，内部" + data.internal_count + "项。正在刷新...";
      st.className = "dialog-status success";
      setTimeout(function () { location.reload(); }, 600);
    } catch (err) {
      st.textContent = "导入失败: " + err.message;
      st.className = "dialog-status error";
      $("btn-upload").disabled = false;
    }
  }

  function buildSubFilter() {
    var sel = $("sub-filter");
    if (!sel) return;
    sel.innerHTML = '<option value="">全部</option>';
    globalSubBarData.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name + " (" + s.total + ")";
      sel.appendChild(opt);
    });
  }

  function buildDeptFilter() {
    var sel = $("dept-filter");
    if (!sel) return;
    sel.innerHTML = '<option value="">全部</option>';
    globalDeptBarData.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name + " (" + s.total + ")";
      sel.appendChild(opt);
    });
  }

  // === Init ===

  async function init() {
    try {
      var summary = await api("/api/alert/summary?" + dateParams());
      if (summary.external && summary.external.length) {
        renderCards("cards-external", summary.external);
        renderCards("cards-internal", summary.internal || []);
      }

      cachedScores = await api("/api/alert/scores");
      chartsDrawn = false;
      drawCharts();

      await refreshSubData();
      buildSubFilter();

      await refreshDeptData();
      buildDeptFilter();

      buildTypeNameFilter();
      await refreshTypeStats();

      window.addEventListener("resize", function () {
        chartsDrawn = false;
        typeChartsDrawn = false;
        drawCharts();
        refreshTypeStats();
      });

      setTimeout(function () {
        chartsDrawn = false;
        typeChartsDrawn = false;
        drawCharts();
        refreshTypeStats();
      }, 400);

    } catch (err) {
      console.error("Alert load error:", err);
      var main = document.querySelector("main");
      main.insertAdjacentHTML("afterbegin",
        '<div class="panel" style="text-align:center;padding:32px;margin-bottom:20px">' +
        '<p style="font-size:16px;color:var(--red);margin-bottom:8px">暂无台账数据</p>' +
        '<p style="font-size:13px;color:var(--muted)">请点击右上角 <b>"导入台账数据"</b> 按钮上传 Excel 文件</p>' +
        '</div>');
    }
  }

  // === Bootstrap ===

  (function setDates() {
    var sd = $("start-date");
    var ed = $("end-date");
    if (sd) sd.value = currentStart;
    if (ed) ed.value = currentEnd;
  })();

  init();

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.id === "btn-import") showImportDialog();
    if (t.id === "btn-cancel") { var d = $("import-dialog"); if (d) d.close(); }
    if (t.id === "btn-upload") doImport();
    if (t.id === "btn-filter") {
      currentStart = ($("start-date") && $("start-date").value) || yearStartISO();
      currentEnd = ($("end-date") && $("end-date").value) || todayISO();
      chartsDrawn = false;
      typeChartsDrawn = false;
      init();
    }
  });

  document.addEventListener("change", function (e) {
    if (e.target.id === "sub-filter") refreshSubData();
    if (e.target.id === "dept-filter") refreshDeptData();
    if (e.target.id === "type-cat-filter") { typeChartsDrawn = false; refreshTypeStats(); }
    if (e.target.id === "type-name-filter") { typeChartsDrawn = false; refreshTypeStats(); }
    if (e.target.id === "import-file") {
      $("btn-upload").disabled = !e.target.files.length;
      var st = $("import-status");
      st.textContent = e.target.files.length ? "已选择: " + e.target.files[0].name : "";
      st.className = "dialog-status";
    }
  });

})();
