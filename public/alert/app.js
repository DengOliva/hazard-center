(function () {
  "use strict";

  function $(id) {
    var el = document.getElementById(id);
    return el;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function api(url) {
    var r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  var currentMonth = 0;

  // ── Cards ──
  function renderCards(containerId, items, months) {
    var container = $(containerId);
    if (!container) return;
    var thisMonthIdx = currentMonth > 0 ? currentMonth - 1 : new Date().getMonth();
    var thisMonthLabel = currentMonth > 0 ? (currentMonth + "月") : (months[thisMonthIdx] || "");

    container.innerHTML = items.map(function (item) {
      var total = item.total || 0;
      var thisMonthVal = total;
      if (currentMonth === 0 && item.monthly) {
        thisMonthVal = thisMonthIdx < item.monthly.length ? item.monthly[thisMonthIdx] : 0;
      }
      var cls = total > 0 ? " highlight" : "";
      return '<div class="stat-card' + cls + '">' +
        '<div class="card-label">' + esc(item.name) + "</div>" +
        '<div class="card-value">' + total + "</div>" +
        '<div class="card-detail">' + (currentMonth > 0 ? (currentMonth + "月 ") : (thisMonthLabel + " ")) + thisMonthVal + " 条 · 累计 " + total + " 条</div>" +
        "</div>";
    }).join("");
  }

  function renderCardsDynamic(containerId, items) {
    var container = $(containerId);
    if (!container) return;
    container.innerHTML = items.map(function (item) {
      var cls = item.count > 0 ? " highlight" : "";
      return '<div class="stat-card' + cls + '">' +
        '<div class="card-label">' + esc(item.name) + "</div>" +
        '<div class="card-value">' + item.count + "</div>" +
        '<div class="card-detail">累计 ' + item.count + " 条</div>" +
        "</div>";
    }).join("") || '<div class="stat-card"><div class="card-label">暂无数据</div><div class="card-value">0</div></div>';
  }

  // ── Line chart ──
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

    // Grid
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    for (var s = 0; s <= 5; s++) {
      var gy = pad.top + (s / 5) * ph;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke();
      var val = yMin + ((5 - s) / 5) * range;
      ctx.fillStyle = "#999"; ctx.font = "11px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(Math.round(val), pad.left - 8, gy + 4);
    }

    // X labels
    ctx.textAlign = "center"; ctx.fillStyle = "#999";
    for (var i = 0; i < months; i++) {
      var lbl = datasets[0].labels[i];
      if (lbl.length > 3) lbl = lbl.replace("月", "");
      ctx.fillText(lbl, x(i), h - pad.bottom + 16);
    }

    // Lines
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

  // ── Pie chart (Canvas) ──
  function drawPieChart(canvasId, external, internal) {
    var canvas = $(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w = parent.getBoundingClientRect().width;
    var h = 220;
    if (w < 10) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);

    var cx = w / 2, cy = h / 2, r = Math.min(cx, cy) - 24;
    if (r < 20) return;
    var total = external + internal;
    if (total === 0) {
      ctx.fillStyle = "#999"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("暂无数据", cx, cy);
      return;
    }

    var extAngle = (external / total) * Math.PI * 2;
    var intAngle = (internal / total) * Math.PI * 2;

    // External slice
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, 0, extAngle);
    ctx.closePath();
    ctx.fillStyle = "#c84d4d"; ctx.fill();

    // Internal slice
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, extAngle, extAngle + intAngle);
    ctx.closePath();
    ctx.fillStyle = "#409eff"; ctx.fill();

    // Center hole (donut style)
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();

    // Center text
    ctx.fillStyle = "#333"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("总计 " + total, cx, cy - 4);
    ctx.font = "11px sans-serif"; ctx.fillStyle = "#999";
    ctx.fillText(external + " / " + internal, cx, cy + 14);

    // Legend drawn below — handled by CSS legend elements in HTML
  }

  // ── Bar chart (horizontal ranking) ──
  function drawBarChart(canvasId, data, maxItems) {
    var canvas = $(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var w = parent.getBoundingClientRect().width;
    maxItems = maxItems || 10;
    var barH = 20, gap = 8, topPad = 8, leftPad = 90, rightPad = 40, bottomPad = 8;
    var h = topPad + (barH + gap) * Math.min(data.length, maxItems) + bottomPad;
    if (w < 10 || data.length === 0 || h < 40) {
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

    var items = data.slice(0, maxItems);
    var maxVal = Math.max.apply(null, items.map(function (d) { return d.total || d.external + d.internal; })) || 1;

    items.forEach(function (item, i) {
      var y = topPad + i * (barH + gap);
      var extVal = item.external || 0;
      var intVal = item.internal || 0;
      var total = extVal + intVal;

      // Label
      ctx.fillStyle = "#333"; ctx.font = "12px sans-serif"; ctx.textAlign = "right";
      var label = item.name;
      if (label.length > 6) label = label.substring(0, 6) + "..";
      ctx.fillText(label, leftPad - 8, y + barH - 5);

      var barAreaW = w - leftPad - rightPad;
      var extW = (extVal / maxVal) * barAreaW;
      var intW = (intVal / maxVal) * barAreaW;

      // External bar
      if (extW > 0) {
        ctx.fillStyle = "#e8c4c4";
        ctx.fillRect(leftPad, y, extW, barH);
        ctx.fillStyle = "#c84d4d";
        ctx.fillRect(leftPad, y, Math.max(extW, 1), barH / 2);
      }
      // Internal bar
      if (intW > 0) {
        ctx.fillStyle = "#b3d8ff";
        ctx.fillRect(leftPad + extW, y, intW, barH);
        ctx.fillStyle = "#409eff";
        ctx.fillRect(leftPad + extW, y + barH / 2, Math.max(intW, 1), barH / 2);
      }
      // Value
      ctx.fillStyle = "#333"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(total, leftPad + extW + intW + 6, y + barH - 5);
    });
  }

  var chartsDrawn = false;
  var cachedScores = null;
  var cachedMonths = [];

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
        { labels: star6.map(function (d) { return d.month; }), data: star6.map(function (d) { return d.score; }), color: "#c84d4d" },
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
        { labels: aq6.map(function (d) { return d.month; }), data: aq6.map(function (d) { return d.score; }), color: "#409eff" },
      ], amin, amax);
    }
    chartsDrawn = true;
  }

  // ── Department table ──
  function renderDeptTable(tableId, headers, rows) {
    var table = $(tableId);
    if (!table) return;
    table.innerHTML = "<thead><tr>" + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead>" +
      "<tbody>" + rows.map(function (row) {
        return "<tr>" + row.map(function (cell, i) {
          return "<td" + (i > 0 ? " class='num'" : "") + ">" + esc(String(cell)) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody>";
  }

  // ── Sub table ──
  function renderSubTable(tableId, items) {
    var table = $(tableId);
    if (!table) return;
    var tbody = table.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = items.map(function (item) {
      return "<tr><td>" + esc(item.name) + "</td><td class='num'>" + item.count + "</td></tr>";
    }).join("") || "<tr><td colspan='2' style='color:var(--muted)'>暂无数据</td></tr>";
  }

  var globalSubs = [];
  var globalSubExternalTypes = [];
  var globalSubInternalTypes = [];
  var globalSubPieData = { external: 0, internal: 0 };
  var globalSubBarData = [];

  var globalDeptExtTypes = [];
  var globalDeptIntTypes = [];
  var globalDeptExtPie = { external: 0, internal: 0 };
  var globalDeptIntPie = { external: 0, internal: 0 };
  var globalDeptBarData = [];
  var globalDeptIntBarData = [];

  // ── Redraw all section 5/6 charts ──
  function redrawSubCharts() {
    drawPieChart("chart-sub-pie", globalSubPieData.external, globalSubPieData.internal);
    drawBarChart("chart-sub-bar", globalSubBarData, 10);
  }

  function redrawDeptCharts() {
    drawPieChart("chart-dept-ext-pie", globalDeptExtPie.external, globalDeptExtPie.internal);
    drawBarChart("chart-dept-bar", globalDeptBarData, 10);
    drawPieChart("chart-dept-int-pie", globalDeptIntPie.external, globalDeptIntPie.internal);
    drawBarChart("chart-dept-int-bar", globalDeptIntBarData, 10);
  }

  // ── Refresh subcontractor section ──
  async function refreshSubData() {
    var subVal = ($("sub-filter") && $("sub-filter").value) || "";
    var params = "?month=" + currentMonth;
    if (subVal) params += "&sub=" + encodeURIComponent(subVal);
    var data = await api("/api/alert/subcontractors" + params);
    globalSubs = data.items || [];
    globalSubExternalTypes = data.external_types || [];
    globalSubInternalTypes = data.internal_types || [];
    globalSubPieData = data.pie_data || { external: 0, internal: 0 };
    globalSubBarData = data.bar_data || [];

    renderCardsDynamic("sub-ext-cards", globalSubExternalTypes);
    renderCardsDynamic("sub-int-cards", globalSubInternalTypes);
    renderSubTable("sub-external-table", globalSubs);
    renderSubTable("sub-internal-table", globalSubs);
    setChartDirty();
    setTimeout(redrawSubCharts, 100);
  }

  // ── Refresh department section ──
  async function refreshDeptData() {
    var params = "?month=" + currentMonth;
    var depts = await api("/api/alert/departments" + params);

    // External
    globalDeptExtTypes = depts.external_types || [];
    globalDeptExtPie = depts.pie_data || { external: 0, internal: 0 };
    globalDeptBarData = depts.bar_data || [];
    renderCardsDynamic("dept-ext-cards", globalDeptExtTypes);
    if (depts.names && depts.names.length) {
      var extHeaders = ["部门"].concat(depts.external.map(function (d) { return d.label; }));
      var extRows = depts.names.map(function (name, i) {
        return [name].concat(depts.external.map(function (d) { return d.values[i] || 0; }));
      });
      renderDeptTable("dept-ext-table", extHeaders, extRows);
    }

    // Internal
    globalDeptIntTypes = depts.internal_types || [];
    globalDeptIntPie = {
      external: depts.pie_data ? depts.pie_data.external : 0,
      internal: depts.pie_data ? depts.pie_data.internal : 0,
    };
    globalDeptIntBarData = depts.bar_data || [];
    renderCardsDynamic("dept-int-cards", globalDeptIntTypes);
    var intData = depts.internal || [];
    renderDeptTable("dept-int-table", ["部门", "整改单(累计)", "违章培训(累计)", "处理通报(累计)"],
      intData.map(function (d) { return [d.name, d.rectification || 0, d.violation || 0, d.notice || 0]; }));

    setChartDirty();
    setTimeout(redrawDeptCharts, 100);
  }

  var subChartsDirty = false, deptChartsDirty = false;
  function setChartDirty() {
    subChartsDirty = true;
    deptChartsDirty = true;
  }

  // ── Import dialog ──
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

  // ── Init ──
  async function init() {
    try {
      var summary = await api("/api/alert/summary?month=" + currentMonth);
      cachedMonths = summary.months || [];
      if (summary.external && summary.external.length) {
        renderCards("cards-external", summary.external, cachedMonths);
        renderCards("cards-internal", summary.internal || [], cachedMonths);
      }

      cachedScores = await api("/api/alert/scores");
      drawCharts();

      await refreshSubData();
      buildSubFilter();

      await refreshDeptData();

      window.addEventListener("resize", function () {
        chartsDrawn = false;
        subChartsDirty = true;
        deptChartsDirty = true;
        drawCharts();
        redrawSubCharts();
        redrawDeptCharts();
      });

      setTimeout(function () {
        chartsDrawn = false;
        subChartsDirty = true;
        deptChartsDirty = true;
        drawCharts();
        redrawSubCharts();
        redrawDeptCharts();
      }, 400);

      // Check dirtiness on animation frames for lazy-drawn canvases
      var checkInterval = setInterval(function () {
        if (subChartsDirty) {
          var c = $("chart-sub-pie");
          if (c && c.parentElement.getBoundingClientRect().width > 10) {
            subChartsDirty = false;
            redrawSubCharts();
          }
        }
        if (deptChartsDirty) {
          var c2 = $("chart-dept-ext-pie");
          if (c2 && c2.parentElement.getBoundingClientRect().width > 10) {
            deptChartsDirty = false;
            redrawDeptCharts();
          }
        }
        if (!subChartsDirty && !deptChartsDirty) clearInterval(checkInterval);
      }, 200);

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

  // ── Bootstrap ──
  init();

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.id === "btn-import") showImportDialog();
    if (t.id === "btn-cancel") { var d = $("import-dialog"); if (d) d.close(); }
    if (t.id === "btn-upload") doImport();
    if (t.classList.contains("tab-btn")) {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
      t.classList.add("active");
      document.querySelectorAll(".dept-content").forEach(function (c) { c.classList.remove("active"); });
      var target = $(t.dataset.tab);
      if (target) {
        target.classList.add("active");
        setChartDirty();
        setTimeout(redrawDeptCharts, 100);
      }
    }
  });

  document.addEventListener("change", function (e) {
    if (e.target.id === "month-filter") {
      currentMonth = parseInt(e.target.value) || 0;
      chartsDrawn = false;
      init(); // re-init with new month
    }
    if (e.target.id === "sub-filter") {
      refreshSubData().then(function () { buildSubFilter(); });
    }
    if (e.target.id === "import-file") {
      $("btn-upload").disabled = !e.target.files.length;
      var st = $("import-status");
      st.textContent = e.target.files.length ? "已选择: " + e.target.files[0].name : "";
      st.className = "dialog-status";
    }
  });

})();
