(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ── API helpers ──
  async function api(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    return r.json();
  }

  // ── Render summary cards ──
  function renderCards(containerId, items, months) {
    const container = $(containerId);
    const currentMonth = new Date().getMonth(); // 0-indexed
    const thisMonthIdx = currentMonth; // Jan=0
    const thisMonthLabel = months[thisMonthIdx] || "";

    container.innerHTML = items
      .map(function (item) {
        let thisMonthVal = 0;
        if (thisMonthIdx < item.monthly.length) {
          thisMonthVal = item.monthly[thisMonthIdx];
        }
        var cls = item.total > 0 ? " highlight" : "";
        return (
          '<div class="stat-card' + cls + '">' +
          '<div class="card-label">' + esc(item.name) + "</div>" +
          '<div class="card-value">' + item.total + "</div>" +
          '<div class="card-detail">' + thisMonthLabel + " " + thisMonthVal + " 条 · 累计 " + item.total + " 条</div>" +
          "</div>"
        );
      })
      .join("");
  }

  // ── Line chart ──
  function drawLineChart(canvasId, datasets, yMin, yMax) {
    var canvas = $(canvasId);
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;

    var rect = canvas.parentElement.getBoundingClientRect();
    var w = rect.width;
    var h = 260;
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
    var steps = 5;
    for (var s = 0; s <= steps; s++) {
      var gy = pad.top + (s / steps) * ph;
      var val = yMin + ((steps - s) / steps) * range;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();
      ctx.fillStyle = "#999";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(Math.round(val), pad.left - 8, gy + 4);
    }

    // X labels
    ctx.textAlign = "center";
    ctx.fillStyle = "#999";
    ctx.font = "11px sans-serif";
    for (var i = 0; i < months; i++) {
      var label = datasets[0].labels[i];
      if (label.length > 3) label = label.replace("月", "");
      ctx.fillText(label, x(i), h - pad.bottom + 16);
    }

    // Lines + dots
    datasets.forEach(function (ds) {
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (var i = 0; i < ds.data.length; i++) {
        var px = x(i), py = y(ds.data[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Dots
      ctx.fillStyle = ds.color;
      for (var i = 0; i < ds.data.length; i++) {
        ctx.beginPath();
        ctx.arc(x(i), y(ds.data[i]), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Zero line
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    var zy = y(0);
    if (zy > pad.top && zy < h - pad.bottom) {
      ctx.beginPath();
      ctx.moveTo(pad.left, zy);
      ctx.lineTo(w - pad.right, zy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  var scoreChartsDrawn = false;
  function drawScoreCharts(scores, months) {
    if (scoreChartsDrawn) return;
    // Wait for container to have width
    var box = document.querySelector(".chart-box");
    if (!box || box.getBoundingClientRect().width < 10) return;

    // Star5 chart
    var star52025 = scores.star5_2025 || [];
    var star52026 = scores.star5_2026 || [];
    var allStar5 = star5_2025.concat(star52026);
    var s5min = allStar5.length ? Math.floor(Math.min.apply(null, allStar5.map(function (d) { return d.score; })) - 2) : 80;
    var s5max = allStar5.length ? Math.ceil(Math.max.apply(null, allStar5.map(function (d) { return d.score; })) + 1) : 100;

    drawLineChart(
      "chart-star5",
      [
        { labels: star5_2025.map(function (d) { return d.month; }), data: star5_2025.map(function (d) { return d.score; }), color: "#e6a23c" },
        { labels: star52026.map(function (d) { return d.month; }), data: star52026.map(function (d) { return d.score; }), color: "#c84d4d" },
      ],
      s5min, s5max
    );

    // AQHB chart
    var aq2025 = scores.aqhb_2025 || [];
    var aq2026 = scores.aqhb_2026 || [];
    var allAq = aq2025.concat(aq2026);
    var amin = allAq.length ? Math.floor(Math.min.apply(null, allAq.map(function (d) { return d.score; })) - 2) : 90;
    var amax = allAq.length ? Math.ceil(Math.max.apply(null, allAq.map(function (d) { return d.score; })) + 1) : 110;

    drawLineChart(
      "chart-aqhb",
      [
        { labels: aq2025.map(function (d) { return d.month; }), data: aq2025.map(function (d) { return d.score; }), color: "#087b68" },
        { labels: aq2026.map(function (d) { return d.month; }), data: aq2026.map(function (d) { return d.score; }), color: "#409eff" },
      ],
      amin, amax
    );

    scoreChartsDrawn = true;
  }

  // ── Department table ──
  function renderDeptTable(tableId, headers, rows) {
    var table = $(tableId);
    var thHtml = "<tr>" + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr>";
    var tbody = "<tbody>" +
      rows
        .map(function (row) {
          return (
            "<tr>" +
            row
              .map(function (cell, i) {
                var cls = i > 0 ? " class='num'" : "";
                return "<td" + cls + ">" + esc(String(cell)) + "</td>";
              })
              .join("") +
            "</tr>"
          );
        })
        .join("") +
      "</tbody>";
    table.innerHTML = thHtml + tbody;
  }

  // ── Subcontractor table ──
  function renderSubTable(tableId, items) {
    var table = $(tableId);
    var tbody = items
      .map(function (item) { return "<tr><td>" + esc(item.name) + "</td><td class='num'>" + item.count + "</td></tr>"; })
      .join("");
    table.querySelector("tbody").innerHTML = tbody || "<tr><td colspan='2' style='color:var(--muted)'>暂无数据</td></tr>";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Init ──
  var globalSubs = [];
  var globalMonths = [];

  async function init() {
    try {
      var summary = await api("/api/alert/summary");
      globalMonths = summary.months || [];
      renderCards("cards-external", summary.external || [], globalMonths);
      renderCards("cards-internal", summary.internal || [], globalMonths);

      var scores = await api("/api/alert/scores");
      drawScoreCharts(scores, globalMonths);

      var depts = await api("/api/alert/departments");

      // External dept table
      var extHeaders = ["部门"].concat(depts.external.map(function (d) { return d.label; }));
      var extRows = depts.names.map(function (name, i) {
        return [name].concat(depts.external.map(function (d) { return d.values[i] || 0; }));
      });
      renderDeptTable("dept-ext-table", extHeaders, extRows);

      // Internal dept table
      var intHeaders = ["部门", "整改单", "违章培训", "处理通报"];
      var intData = depts.internal || [];
      var intLen = intHeaders.length;
      var intRows = intData.map(function (d) {
        var arr = [d.name, d.rectification || 0, d.violation || 0, d.notice || 0];
        while (arr.length < intLen) arr.push(0);
        return arr;
      });
      renderDeptTable("dept-int-table", ["部门", "整改单(累计)", "违章培训(累计)", "处理通报(累计)"], intRows);

      // Subcontractors
      var subData = await api("/api/alert/subcontractors");
      globalSubs = subData.items || [];
      renderSubTable("sub-external-table", globalSubs);
      renderSubTable("sub-internal-table", globalSubs);
      populateSubFilter();

      // Redraw charts after layout settles
      window.addEventListener("resize", function () {
        scoreChartsDrawn = false;
        drawScoreCharts(scores, globalMonths);
      });
      setTimeout(function () {
        scoreChartsDrawn = false;
        drawScoreCharts(scores, globalMonths);
      }, 300);

    } catch (err) {
      console.error("Failed to load alert dashboard:", err);
      var main = document.querySelector("main");
      main.innerHTML =
        '<div class="panel" style="text-align:center;padding:40px">' +
        '<p style="font-size:16px;color:var(--red);margin-bottom:12px">暂无数据，请先导入台账文件</p>' +
        '<p style="font-size:13px;color:var(--muted)">点击右上角 "导入台账数据" 按钮上传</p>' +
        '<p style="font-size:13px;color:var(--muted)">文件：防城港三期安全管理数据总台账.xlsx</p>' +
        '</div>';
    }
  }

  function populateSubFilter() {
    var sel = $("sub-filter");
    globalSubs.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name + " (" + s.count + ")";
      sel.appendChild(opt);
    });
  }

  // ── Import dialog ──
  function showImportDialog() {
    $("import-dialog").showModal();
    $("import-file").value = "";
    $("import-status").textContent = "";
    $("import-status").className = "dialog-status";
    $("btn-upload").disabled = true;
  }

  async function doImport() {
    var file = $("import-file").files[0];
    if (!file) return;
    var status = $("import-status");
    status.textContent = "正在上传解析...";
    status.className = "dialog-status";
    $("btn-upload").disabled = true;

    var fd = new FormData();
    fd.append("file", file);
    try {
      var r = await fetch("/api/alert/import", { method: "POST", body: fd });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || "上传失败");
      status.textContent = "导入成功！外部" + data.external_count + "项，内部" + data.internal_count + "项。正在刷新...";
      status.className = "dialog-status success";
      setTimeout(function () {
        $("import-dialog").close();
        location.reload();
      }, 800);
    } catch (err) {
      status.textContent = "导入失败: " + err.message;
      status.className = "dialog-status error";
      $("btn-upload").disabled = false;
    }
  }

  // ── Event handlers ──
  document.addEventListener("DOMContentLoaded", function () {
    init();

    // Import button
    $("btn-import").addEventListener("click", showImportDialog);
    $("btn-cancel").addEventListener("click", function () { $("import-dialog").close(); });
    $("btn-upload").addEventListener("click", doImport);
    $("import-file").addEventListener("change", function () {
      $("btn-upload").disabled = !this.files.length;
      $("import-status").textContent = this.files.length ? "已选择: " + this.files[0].name : "";
      $("import-status").className = "dialog-status";
    });

    // Subcontractor filter
    document.addEventListener("change", function (e) {
      if (e.target.id === "sub-filter") {
        var val = e.target.value;
        var filtered = val ? globalSubs.filter(function (s) { return s.name === val; }) : globalSubs;
        renderSubTable("sub-external-table", filtered);
        renderSubTable("sub-internal-table", filtered);
      }
    });

    // Department tabs
    document.addEventListener("click", function (e) {
      if (e.target.classList.contains("tab-btn")) {
        var tab = e.target.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        e.target.classList.add("active");
        document.querySelectorAll(".dept-content").forEach(function (c) { c.classList.remove("active"); });
        var target = document.getElementById(tab);
        if (target) target.classList.add("active");
      }
    });
  });
})();
