(function () {
  "use strict";

  const STORAGE_KEY = "kiln-planner-state-v1";

  const $ = (selector) => document.querySelector(selector);
  const els = {
    statusPills: $("#statusPills"),
    riskCard: $("#riskCard"),
    kilnActions: $("#kilnActions"),
    layerList: $("#layerList"),
    addWareForm: $("#addWareForm"),
    waitingList: $("#waitingList"),
    settingsCard: $("#settingsCard"),
    ownersCard: $("#ownersCard"),
    historyCard: $("#historyCard"),
    firingModal: $("#firingModal"),
    firingContent: $("#firingContent"),
    toast: $("#toast")
  };

  let state = loadState();
  let lastAnalysis = createEmptyAnalysis();
  let ui = { firingDraft: {}, toastTimer: null };

  const severityRank = { error: 3, warning: 2, info: 1 };
  const severityLabel = { error: "阻断", warning: "提醒", info: "参考" };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "未知日期";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getWare(wareId) {
    return state.wares.find((ware) => ware.id === wareId);
  }

  function getPlacement(wareId) {
    return state.placements.find((placement) => placement.wareId === wareId);
  }

  function placedWares() {
    return state.placements
      .map((placement) => ({ placement, ware: getWare(placement.wareId) }))
      .filter((item) => Boolean(item.ware));
  }

  function waitingWares() {
    return state.wares.filter((ware) => !getPlacement(ware.id));
  }

  function totalSlots() {
    return state.kiln.layers * state.kiln.positionsPerLayer;
  }

  function isLowerLayer(layer) {
    return layer >= state.kiln.layers - state.kiln.lowerLayers;
  }

  function layerName(layer) {
    return layer === state.kiln.layers - 1 ? "底层" : `第 ${layer + 1} 层`;
  }

  function slotLabel(layer, position) {
    return `${layer + 1}-${position + 1}`;
  }

  function sameKilnTemps(extraWare) {
    const temps = placedWares().map((item) => item.ware.temp);
    if (extraWare) temps.push(extraWare.temp);
    return temps;
  }

  function sameKilnRange(extraWare) {
    const temps = sameKilnTemps(extraWare);
    if (!temps.length) return 0;
    return Math.max(...temps) - Math.min(...temps);
  }

  function isNear(a, b) {
    const layerDistance = Math.abs(a.layer - b.layer);
    const positionDistance = Math.abs(a.position - b.position);
    return layerDistance + positionDistance <= 1;
  }

  function damagedPositionCount() {
    const counts = new Map();
    state.history.forEach((batch) => {
      batch.results.forEach((result) => {
        if (result.status === "bad" && Number.isInteger(result.layer) && Number.isInteger(result.position)) {
          counts.set(`${result.layer}-${result.position}`, (counts.get(`${result.layer}-${result.position}`) || 0) + 1);
        }
      });
    });
    return counts;
  }

  function damagedLayerCount() {
    const counts = new Map();
    state.history.forEach((batch) => {
      batch.results.forEach((result) => {
        if (result.status === "bad" && Number.isInteger(result.layer)) {
          counts.set(result.layer, (counts.get(result.layer) || 0) + 1);
        }
      });
    });
    return counts;
  }

  function createEmptyAnalysis() {
    return { issues: [], byWare: {}, byLayer: {} };
  }

  function seedState() {
    const wares = [
      { id: "w1", name: "青釉茶盏", owner: "阿禾", temp: 1280, drip: true },
      { id: "w2", name: "白瓷碗", owner: "阿禾", temp: 1275, drip: false },
      { id: "w3", name: "米釉花器", owner: "青川", temp: 1285, drip: true },
      { id: "w4", name: "青瓷杯", owner: "青川", temp: 1290, drip: false },
      { id: "w5", name: "素胎小壶", owner: "林姐", temp: 1278, drip: false },
      { id: "w6", name: "黑釉盏", owner: "林姐", temp: 1298, drip: true },
      { id: "w7", name: "高温花插", owner: "老周", temp: 1300, drip: false },
      { id: "w8", name: "低温釉盆", owner: "老周", temp: 1190, drip: false },
      { id: "w9", name: "低温香插", owner: "阿禾", temp: 1205, drip: false }
    ];
    const placements = [
      { id: uid("p"), wareId: "w1", layer: 3, position: 0 },
      { id: uid("p"), wareId: "w3", layer: 3, position: 1 },
      { id: uid("p"), wareId: "w6", layer: 3, position: 2 },
      { id: uid("p"), wareId: "w2", layer: 2, position: 0 },
      { id: uid("p"), wareId: "w4", layer: 2, position: 1 },
      { id: uid("p"), wareId: "w5", layer: 2, position: 2 },
      { id: uid("p"), wareId: "w7", layer: 1, position: 2 }
    ];
    return {
      kiln: {
        layers: 4,
        positionsPerLayer: 5,
        lowerLayers: 1,
        maxKilnTempDiff: 30,
        nearbyTempDiff: 10,
        locked: false
      },
      wares,
      placements,
      history: [
        {
          id: uid("b"),
          firedAt: "2026-09-14T09:30:00+08:00",
          note: "底层靠窑门处火急，黑釉盏底部有落渣。",
          results: [
            { wareName: "黑釉盏", owner: "林姐", temp: 1298, layer: 3, position: 2, status: "bad", note: "3-3 靠窑门，底部落渣" },
            { wareName: "青瓷杯", owner: "青川", temp: 1290, layer: 3, position: 1, status: "flaw", note: "3-2 轻微变形" }
          ]
        }
      ]
    };
  }

  function defaultState() {
    return {
      kiln: {
        layers: 4,
        positionsPerLayer: 5,
        lowerLayers: 1,
        maxKilnTempDiff: 30,
        nearbyTempDiff: 10,
        locked: false
      },
      wares: [],
      placements: [],
      history: []
    };
  }

  function normalizeState(saved) {
    const base = seedState();
    const kiln = { ...base.kiln, ...(saved && saved.kiln ? saved.kiln : {}) };
    kiln.layers = clampInt(kiln.layers, 2, 10, 4);
    kiln.positionsPerLayer = clampInt(kiln.positionsPerLayer, 2, 12, 5);
    kiln.lowerLayers = clampInt(kiln.lowerLayers, 1, Math.max(1, Math.floor(kiln.layers / 2)), 1);
    kiln.maxKilnTempDiff = clampInt(kiln.maxKilnTempDiff, 1, 300, 30);
    kiln.nearbyTempDiff = clampInt(kiln.nearbyTempDiff, 1, 200, 10);
    kiln.locked = Boolean(kiln.locked);

    const wares = Array.isArray(saved && saved.wares) ? saved.wares : base.wares;
    const placements = Array.isArray(saved && saved.placements) ? saved.placements : base.placements;
    const history = Array.isArray(saved && saved.history) ? saved.history : base.history;

    return {
      kiln,
      wares: wares.map(normalizeWare).filter(Boolean),
      placements: placements
        .map((placement) => normalizePlacement(placement, kiln))
        .filter(Boolean),
      history: history.map(normalizeBatch).filter(Boolean)
    };
  }

  function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeWare(ware) {
    if (!ware || !ware.name || !ware.owner) return null;
    return {
      id: String(ware.id || uid("w")),
      name: String(ware.name).slice(0, 30),
      owner: String(ware.owner).slice(0, 20),
      temp: clampInt(ware.temp, 500, 1500, 1280),
      drip: Boolean(ware.drip)
    };
  }

  function normalizePlacement(placement, kiln) {
    if (!placement || !placement.wareId) return null;
    return {
      id: String(placement.id || uid("p")),
      wareId: String(placement.wareId),
      layer: clampInt(placement.layer, 0, kiln.layers - 1, 0),
      position: clampInt(placement.position, 0, kiln.positionsPerLayer - 1, 0)
    };
  }

  function normalizeBatch(batch) {
    if (!batch || !Array.isArray(batch.results)) return null;
    return {
      id: String(batch.id || uid("b")),
      firedAt: batch.firedAt || new Date().toISOString(),
      note: String(batch.note || ""),
      results: batch.results.map((result) => ({
        wareName: String(result.wareName || ""),
        owner: String(result.owner || ""),
        temp: clampInt(result.temp, 500, 1500, 0),
        layer: Number.isInteger(result.layer) ? result.layer : null,
        position: Number.isInteger(result.position) ? result.position : null,
        status: ["good", "flaw", "bad"].includes(result.status) ? result.status : "good",
        note: String(result.note || "")
      }))
    };
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : seedState();
    } catch (error) {
      return seedState();
    }
  }

  function persist() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeIssue(level, title, detail, options = {}) {
    return {
      id: uid("i"),
      level,
      title,
      detail,
      wareIds: options.wareIds || [],
      layer: Number.isInteger(options.layer) ? options.layer : null
    };
  }

  function placementMap() {
    const map = new Map();
    state.placements.forEach((placement) => map.set(`${placement.layer}-${placement.position}`, placement));
    return map;
  }

  function analyze() {
    const analysis = createEmptyAnalysis();
    const occupied = placementMap();
    const items = placedWares();

    function add(issue) {
      analysis.issues.push(issue);
      issue.wareIds.forEach((wareId) => {
        if (!analysis.byWare[wareId]) analysis.byWare[wareId] = [];
        analysis.byWare[wareId].push(issue);
      });
      if (Number.isInteger(issue.layer)) {
        analysis.byLayer[issue.layer] = analysis.byLayer[issue.layer] || { error: 0, warning: 0, info: 0 };
        analysis.byLayer[issue.layer][issue.level] += 1;
      }
    }

    if (items.length) {
      const temps = items.map((item) => item.ware.temp);
      const range = Math.max(...temps) - Math.min(...temps);
      if (range > state.kiln.maxKilnTempDiff) {
        add(makeIssue(
          "error",
          `同窑温差 ${range}℃，超过 ${state.kiln.maxKilnTempDiff}℃`,
          `当前区间 ${Math.min(...temps)}℃–${Math.max(...temps)}℃，不能同窑烧。请移出高温差坯体后再锁炉。`,
          { wareIds: items.map((item) => item.ware.id) }
        ));
      }
    }

    const damageCounts = damagedLayerCount();
    const damagePositions = damagedPositionCount();
    items.forEach(({ placement, ware }) => {
      if (ware.drip && !isLowerLayer(placement.layer)) {
        add(makeIssue(
          "warning",
          `${ware.name} 是滴釉坯但不在下层`,
          `现在位于 ${layerName(placement.layer)} ${placement.position + 1} 号位；釉水滴落会影响下方坯体和窑板。`,
          { wareIds: [ware.id], layer: placement.layer }
        ));
      }

      const above = occupied.get(`${placement.layer - 1}-${placement.position}`);
      if (ware.drip && above) {
        const aboveWare = getWare(above.wareId);
        if (aboveWare) {
          add(makeIssue(
            "warning",
            `${aboveWare.name} 正下方是滴釉坯`,
            `${ware.name} 会向下方及隔板滴落，可能影响该区域；请确认接釉和间距。`,
            { wareIds: [aboveWare.id, ware.id], layer: placement.layer - 1 }
          ));
        }
      }

      if (damageCounts.has(placement.layer)) {
        add(makeIssue(
          "info",
          `${layerName(placement.layer)} 曾有 ${damageCounts.get(placement.layer)} 次坏损记录`,
          damagePositions.has(`${placement.layer}-${placement.position}`)
            ? `这个号位曾坏 ${damagePositions.get(`${placement.layer}-${placement.position}`)} 次，请翻看坏损原因。`
            : "该层曾有坏损，装窑前请翻看具体号位和原因。",
          { wareIds: [ware.id], layer: placement.layer }
        ));
      }
    });

    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (!isNear(a.placement, b.placement)) continue;
        const diff = Math.abs(a.ware.temp - b.ware.temp);
        if (diff > state.kiln.nearbyTempDiff) {
          add(makeIssue(
            "warning",
            `近位温差 ${diff}℃：${a.ware.name} / ${b.ware.name}`,
            `两件位置相邻或上下相邻（${slotLabel(a.placement.layer, a.placement.position)} 与 ${slotLabel(b.placement.layer, b.placement.position)}），可能互相影响。`,
            { wareIds: [a.ware.id, b.ware.id], layer: a.placement.layer }
          ));
        }
      }
    }

    analysis.issues.sort((a, b) => severityRank[b.level] - severityRank[a.level]);
    return analysis;
  }

  function candidateChecks(ware, layer, position, options = {}) {
    const issues = [];
    const occupied = options.occupied || placementMap();
    if (layer < 0 || layer >= state.kiln.layers || position < 0 || position >= state.kiln.positionsPerLayer) {
      issues.push(makeIssue("error", "窑位不存在", "层号或位号超出当前窑炉设置。"));
    }
    if (occupied.has(`${layer}-${position}`)) {
      issues.push(makeIssue("error", "窑位已被占用", `请先移走 ${slotLabel(layer, position)} 的坯体。`, { layer }));
    }
    if (sameKilnRange(ware) > state.kiln.maxKilnTempDiff) {
      const temps = sameKilnTemps(ware);
      issues.push(makeIssue(
        "error",
        `放入后同窑温差 ${Math.max(...temps) - Math.min(...temps)}℃`,
        `超过 ${state.kiln.maxKilnTempDiff}℃，温度要求差太多，不能同窑。`,
        { layer }
      ));
    }
    if (ware.drip && !isLowerLayer(layer)) {
      issues.push(makeIssue(
        "warning",
        "滴釉坯未放下层",
        `${layerName(layer)} 不属于滴釉下层；仍可手动放入，但会标出风险。`,
        { wareIds: [ware.id], layer }
      ));
    }
    const above = occupied.get(`${layer - 1}-${position}`);
    if (ware.drip && above && getWare(above.wareId)) {
      issues.push(makeIssue(
        "warning",
        "正上方已有坯体",
        `${getWare(above.wareId).name} 位于同一号位上层，滴釉前请确认间距和接釉。`,
        { wareIds: [getWare(above.wareId).id, ware.id], layer: layer - 1 }
      ));
    }
    occupied.forEach((placement) => {
      const other = getWare(placement.wareId);
      if (!other || !isNear({ layer, position }, placement)) return;
      const diff = Math.abs(ware.temp - other.temp);
      if (diff > state.kiln.nearbyTempDiff) {
        issues.push(makeIssue(
          "warning",
          `与邻近的 ${other.name} 温差 ${diff}℃`,
          `近位提醒阈值为 ${state.kiln.nearbyTempDiff}℃。`,
          { wareIds: [ware.id, other.id], layer }
        ));
      }
    });
    const damageCounts = damagedLayerCount();
    const damagePositions = damagedPositionCount();
    if (damageCounts.has(layer)) {
      issues.push(makeIssue(
        "info",
        damagePositions.has(`${layer}-${position}`)
          ? `${slotLabel(layer, position)} 号位曾坏 ${damagePositions.get(`${layer}-${position}`)} 次`
          : `${layerName(layer)} 有 ${damageCounts.get(layer)} 次历史坏损`,
        damagePositions.has(`${layer}-${position}`)
          ? "同一层、同一号位曾出问题，务必结合原因复查。"
          : "该层需要结合上次坏损号位和原因复查。",
        { wareIds: [ware.id], layer }
      ));
    }
    return issues;
  }

  function slotChoices(ware) {
    const choices = [];
    for (let layer = 0; layer < state.kiln.layers; layer += 1) {
      for (let position = 0; position < state.kiln.positionsPerLayer; position += 1) {
        const issues = candidateChecks(ware, layer, position);
        if (!issues.some((issue) => issue.level === "error")) {
          choices.push({ layer, position, issues, score: choiceScore(issues, layer, position) });
        }
      }
    }
    choices.sort((a, b) => a.score - b.score || a.layer - b.layer || a.position - b.position);
    return choices;
  }

  function choiceScore(issues, layer, position) {
    const weights = { error: 1000, warning: 30, info: 5 };
    let score = issues.reduce((total, issue) => total + weights[issue.level], 0);
    if (isLowerLayer(layer)) score -= 1;
    const nearbyCount = placedWares().filter(({ placement }) => isNear({ layer, position }, placement)).length;
    if (nearbyCount > 0) score -= Math.min(nearbyCount, 3) * 2;
    return score;
  }

  function noSlotReason(ware) {
    const emptySlots = totalSlots() - state.placements.length;
    if (emptySlots <= 0) return "窑位已满";
    const checks = [];
    for (let layer = 0; layer < state.kiln.layers; layer += 1) {
      for (let position = 0; position < state.kiln.positionsPerLayer; position += 1) {
        candidateChecks(ware, layer, position).forEach((issue) => checks.push(issue));
      }
    }
    const hard = checks.find((issue) => issue.level === "error");
    return hard ? hard.title : "暂无可放位置";
  }

  function assignWare(wareId, layer, position) {
    const ware = getWare(wareId);
    if (!ware) return false;
    const existingPlacement = getPlacement(wareId);
    if (state.kiln.locked && existingPlacement) {
      toast("锁炉后不能挪动已有坯体，只能向剩余空位补件。");
      return false;
    }
    const issues = candidateChecks(ware, Number(layer), Number(position));
    if (issues.some((issue) => issue.level === "error")) {
      const hard = issues.find((issue) => issue.level === "error");
      toast(hard.title);
      return false;
    }
    const targetLayer = Number(layer);
    const targetPosition = Number(position);
    const addingToLockedKiln = state.kiln.locked && !existingPlacement;
    if (addingToLockedKiln) {
      const candidatePlacement = { id: uid("p"), wareId, layer: targetLayer, position: targetPosition };
      state.placements.push(candidatePlacement);
      const review = analyze();
      state.placements = state.placements.filter((placement) => placement.id !== candidatePlacement.id);
      const errors = review.issues.filter((issue) => issue.level === "error").length;
      const warnings = review.issues.filter((issue) => issue.level === "warning").length;
      const infos = review.issues.filter((issue) => issue.level === "info").length;
      if (errors) {
        toast(`整窑复核未通过：${errors} 条阻断，不能加进锁炉。`);
        return false;
      }
      const confirmed = window.confirm(`加件前整窑复核：${warnings} 条提醒、${infos} 条历史参考。不能挪动他人位置，确认加入剩余空位并保持锁炉？`);
      if (!confirmed) return false;
      state.placements.push(candidatePlacement);
    } else {
      state.placements = state.placements.filter((placement) => placement.wareId !== wareId);
      state.placements.push({ id: uid("p"), wareId, layer: targetLayer, position: targetPosition });
      const review = analyze();
      if (review.issues.some((issue) => issue.level === "error")) {
        state.placements = state.placements.filter((placement) => placement.wareId !== wareId);
        toast("整窑复核未通过，已取消放入。");
        return false;
      }
    }
    persist();
    render();
    const warnings = issues.filter((issue) => issue.level !== "error").length;
    toast(warnings ? `已放入，但有 ${warnings} 条现场风险。` : "已放入窑位。");
    return true;
  }

  function removeWare(wareId) {
    if (state.kiln.locked) {
      toast("炉子已锁，不能移出。");
      return;
    }
    state.placements = state.placements.filter((placement) => placement.wareId !== wareId);
    persist();
    render();
    toast("已移出，坯体回到待烧清单。");
  }

  function deleteWare(wareId) {
    const placement = getPlacement(wareId);
    if (state.kiln.locked && placement) {
      toast("锁炉后不能删除窑内坯体；未入窑的待烧坯体可删除。");
      return;
    }
    if (placement && !window.confirm("该坯体已在窑里，确认移出并删除？")) return;
    state.wares = state.wares.filter((ware) => ware.id !== wareId);
    state.placements = state.placements.filter((item) => item.wareId !== wareId);
    persist();
    render();
    toast("坯体已删除。");
  }

  function autoAssign() {
    if (state.kiln.locked) {
      toast("锁炉后不批量自动排位，请手动选择剩余空位并逐件复核。");
      return;
    }
    let remaining = waitingWares();
    if (!remaining.length) {
      toast("待烧清单为空。");
      return;
    }
    const placed = [];
    while (remaining.length) {
      let best = null;
      remaining.forEach((ware) => {
        const choices = slotChoices(ware);
        choices.forEach((choice) => {
          const candidatePlacement = { id: uid("p"), wareId: ware.id, layer: choice.layer, position: choice.position };
          state.placements.push(candidatePlacement);
          const review = analyze();
          state.placements = state.placements.filter((placement) => placement.id !== candidatePlacement.id);
          if (review.issues.some((issue) => issue.level === "error")) return;
          const candidate = { ware, choice, validCount: choices.length };
          if (!best ||
            candidate.validCount < best.validCount ||
            (candidate.validCount === best.validCount && candidate.choice.score < best.choice.score)) {
            best = candidate;
          }
        });
      });
      if (!best) break;
      state.placements.push({
        id: uid("p"),
        wareId: best.ware.id,
        layer: best.choice.layer,
        position: best.choice.position
      });
      placed.push(best.ware);
      remaining = remaining.filter((ware) => ware.id !== best.ware.id);
    }
    persist();
    render();
    const left = waitingWares().length;
    toast(placed.length ? `已自动摆入 ${placed.length} 件，${left} 件留在待烧清单。` : "没有能摆下的位置。");
  }

  function clearPlacements() {
    if (state.kiln.locked) {
      toast("炉子已锁，不能清空。");
      return;
    }
    if (!state.placements.length) {
      toast("窑里本来就是空的。");
      return;
    }
    if (!window.confirm("清空当前窑位？所有坯体会回到待烧清单，历史记录保留。")) return;
    state.placements = [];
    persist();
    render();
    toast("已清空窑位。");
  }

  function addWare(formData) {
    const ware = normalizeWare({
      id: uid("w"),
      name: formData.get("name"),
      owner: formData.get("owner"),
      temp: formData.get("temp"),
      drip: formData.get("drip") === "on"
    });
    if (!ware) {
      toast("请填写完整的坯体信息。");
      return;
    }
    state.wares.push(ware);
    persist();
    els.addWareForm.reset();
    render();
    toast(`${ware.name} 已加入待烧清单。`);
  }

  function saveSettings(formData) {
    if (state.kiln.locked) {
      toast("炉子锁定时不能改层数或阈值，请先解锁并复核。");
      return;
    }
    const layers = clampInt(Number(formData.get("layers")), 2, 10, state.kiln.layers);
    const positionsPerLayer = clampInt(Number(formData.get("positionsPerLayer")), 2, 12, state.kiln.positionsPerLayer);
    const lowerLayers = clampInt(Number(formData.get("lowerLayers")), 1, Math.max(1, Math.floor(layers / 2)), state.kiln.lowerLayers);
    const maxKilnTempDiff = clampInt(Number(formData.get("maxKilnTempDiff")), 1, 300, state.kiln.maxKilnTempDiff);
    const nearbyTempDiff = clampInt(Number(formData.get("nearbyTempDiff")), 1, 200, state.kiln.nearbyTempDiff);

    state.placements = state.placements.filter((placement) =>
      placement.layer < layers && placement.position < positionsPerLayer);
    state.kiln = {
      ...state.kiln,
      layers,
      positionsPerLayer,
      lowerLayers,
      maxKilnTempDiff,
      nearbyTempDiff
    };
    persist();
    render();
    toast("窑炉设置已保存，超出新窑位的坯体已回到待烧清单。");
  }

  function lockKiln() {
    if (state.kiln.locked) return;
    const analysis = analyze();
    const errors = analysis.issues.filter((issue) => issue.level === "error");
    if (errors.length) {
      toast(`不能锁炉：还有 ${errors.length} 条阻断风险。`);
      return;
    }
    const warnings = analysis.issues.filter((issue) => issue.level === "warning");
    if (warnings.length && !window.confirm(`仍有 ${warnings.length} 条提醒风险。确认接受这些风险并锁炉？`)) return;
    state.kiln.locked = true;
    persist();
    render();
    toast("炉子已锁定，后来的人只能挑下一次窑或等解锁。");
  }

  function unlockKiln() {
    if (!state.kiln.locked) return;
    const analysis = analyze();
    const errors = analysis.issues.filter((issue) => issue.level === "error").length;
    const warnings = analysis.issues.filter((issue) => issue.level === "warning").length;
    const message = `解锁后必须把整窑风险重新过一遍。当前 ${errors} 条阻断、${warnings} 条提醒，确认解锁？`;
    if (!window.confirm(message)) return;
    state.kiln.locked = false;
    persist();
    render();
    toast("已解锁，请重新检查温度、釉滴和窑位后再锁。");
  }

  function resetAll() {
    if (!window.confirm("清空全部坯体、窑位和历史？此操作不能撤销。")) return;
    state = defaultState();
    persist();
    render();
    toast("已清空全部数据。");
  }

  function loadSample() {
    if (state.kiln.locked) {
      toast("炉子已锁，不能载入示例。");
      return;
    }
    if (!window.confirm("载入示例会覆盖当前全部数据，确定继续？")) return;
    state = seedState();
    persist();
    render();
    toast("示例数据已载入。");
  }

  function openFiring() {
    if (!state.kiln.locked) {
      toast("先确认风险并锁住炉子，烧完后再开炉结算。");
      return;
    }
    ui.firingDraft = {};
    placedWares().forEach(({ ware, placement }) => {
      ui.firingDraft[ware.id] = {
        status: "good",
        layer: placement.layer,
        note: ""
      };
    });
    renderFiringModal();
    els.firingModal.classList.remove("hidden");
  }

  function closeFiring() {
    els.firingModal.classList.add("hidden");
    ui.firingDraft = {};
  }

  function saveFiring(formData) {
    const items = placedWares();
    if (!items.length) {
      toast("窑里没有可记录的坯体。");
      return;
    }
    const results = items.map(({ ware, placement }) => {
      const rawLayer = formData.get(`layer-${ware.id}`);
      return {
        wareName: ware.name,
        owner: ware.owner,
        temp: ware.temp,
        layer: rawLayer === "" ? null : clampInt(Number(rawLayer) - 1, 0, state.kiln.layers - 1, placement.layer),
        position: placement.position,
        status: formData.get(`status-${ware.id}`) || "good",
        note: String(formData.get(`note-${ware.id}`) || "").trim()
      };
    });
    state.history.unshift({
      id: uid("b"),
      firedAt: new Date().toISOString(),
      note: String(formData.get("batchNote") || "").trim(),
      results
    });
    state.placements = [];
    state.kiln.locked = false;
    persist();
    closeFiring();
    render();
    const bad = results.filter((result) => result.status !== "good").length;
    toast(`已归档本炉 ${results.length} 件，其中 ${bad} 件有瑕疵或烧坏；窑位已清空。`);
  }

  function deleteHistoryBatch(batchId) {
    if (!window.confirm("删除这一炉的历史记录？")) return;
    state.history = state.history.filter((batch) => batch.id !== batchId);
    persist();
    render();
    toast("历史记录已删除。");
  }

  function clearHistory() {
    if (!state.history.length) {
      toast("暂无历史记录。");
      return;
    }
    if (!window.confirm("清空全部烧窑历史？当前窑位不会改变。")) return;
    state.history = [];
    persist();
    render();
    toast("历史坏损记录已清空。");
  }

  function render() {
    lastAnalysis = analyze();
    renderStatusPills();
    renderRiskCard();
    renderKiln();
    renderWaiting();
    renderSettings();
    renderOwners();
    renderHistory();
  }

  function renderStatusPills() {
    const errors = lastAnalysis.issues.filter((issue) => issue.level === "error").length;
    const warnings = lastAnalysis.issues.filter((issue) => issue.level === "warning").length;
    const occupied = state.placements.length;
    const free = totalSlots() - occupied;
    const pills = [
      `<span class="pill">窑位 <strong>${occupied}/${totalSlots()}</strong></span>`,
      `<span class="pill">空位 <strong>${free}</strong></span>`,
      `<span class="pill">待烧 <strong>${waitingWares().length}</strong></span>`,
      `<span class="pill">阻断 <strong class="${errors ? "text-danger" : ""}">${errors}</strong></span>`,
      `<span class="pill">提醒 <strong class="${warnings ? "text-warning" : ""}">${warnings}</strong></span>`,
      `<span class="pill">${state.kiln.locked ? "<strong class='text-danger'>已锁定</strong>" : "<strong class='text-ok'>可调整</strong>"}</span>`
    ];
    els.statusPills.innerHTML = pills.join("");
  }

  function renderRiskCard() {
    const errors = lastAnalysis.issues.filter((issue) => issue.level === "error");
    const warnings = lastAnalysis.issues.filter((issue) => issue.level === "warning");
    const infos = lastAnalysis.issues.filter((issue) => issue.level === "info");
    const stateClass = errors.length ? "has-error" : warnings.length ? "has-warning" : "ok";
    const headline = errors.length
      ? "有阻断风险，不能锁炉"
      : warnings.length
        ? "可以调整后再锁炉"
        : state.placements.length
          ? "当前未见温度或釉料风险"
          : "窑内为空，可从待烧清单开始摆位";
    const list = lastAnalysis.issues.length
      ? `<ul class="issue-list">${lastAnalysis.issues.slice(0, 8).map(renderIssue).join("")}</ul>`
      : `<p class="empty-note">同窑温差、近位温差、滴釉层位和历史坏层都会在这里当场标出。</p>`;

    els.riskCard.className = `card risk-card ${stateClass}`;
    els.riskCard.innerHTML = `
      <div class="risk-head">
        <div>
          <p class="section-kicker">Risk Check</p>
          <h2 id="riskTitle">${headline}</h2>
        </div>
        <div class="risk-score">
          <span class="badge error">阻断 ${errors.length}</span>
          <span class="badge warning">提醒 ${warnings.length}</span>
          <span class="badge info">历史 ${infos.length}</span>
        </div>
      </div>
      <div class="risk-summary">
        <div class="risk-stat error"><span>同窑温度红线</span><strong>${state.kiln.maxKilnTempDiff}℃</strong></div>
        <div class="risk-stat warning"><span>近位提醒阈值</span><strong>${state.kiln.nearbyTempDiff}℃</strong></div>
        <div class="risk-stat info"><span>滴釉下层</span><strong>下 ${state.kiln.lowerLayers} 层</strong></div>
      </div>
      ${list}
    `;
  }

  function renderIssue(issue) {
    return `<li class="issue ${issue.level}"><b>${severityLabel[issue.level]}</b><span><strong>${escapeHtml(issue.title)}</strong><br>${escapeHtml(issue.detail)}</span></li>`;
  }

  function renderKiln() {
    const occupied = placementMap();
    const lockButton = state.kiln.locked
      ? `<button type="button" data-action="unlock-kiln">解锁并整窑复核</button>`
      : `<button type="button" class="primary" data-action="lock-kiln" ${state.placements.length ? "" : "disabled"}>锁炉</button>`;
    els.kilnActions.innerHTML = `
      <button type="button" data-action="auto-assign" ${state.kiln.locked ? "disabled" : ""}>自动排位</button>
      ${lockButton}
      <button type="button" data-action="open-firing" ${state.kiln.locked ? "" : "disabled"}>烧完开炉</button>
      <button type="button" class="danger" data-action="clear-placements" ${state.kiln.locked ? "disabled" : ""}>清空窑位</button>
    `;

    const layers = [];
    for (let layer = 0; layer < state.kiln.layers; layer += 1) {
      const layerIssues = lastAnalysis.byLayer[layer] || { error: 0, warning: 0, info: 0 };
      const lower = isLowerLayer(layer);
      const slots = [];
      for (let position = 0; position < state.kiln.positionsPerLayer; position += 1) {
        const placement = occupied.get(`${layer}-${position}`);
        slots.push(placement ? renderOccupiedSlot(placement, layer, position) : renderEmptySlot(layer, position));
      }
      const layerBadges = [
        layerIssues.error ? `<span class="badge error">${layerIssues.error} 阻断</span>` : "",
        layerIssues.warning ? `<span class="badge warning">${layerIssues.warning} 提醒</span>` : "",
        layerIssues.info ? `<span class="badge info">${layerIssues.info} 历史</span>` : ""
      ].join("");
      layers.push(`
        <article class="layer">
          <div class="layer-head">
            <div class="layer-title">
              <strong>${layerName(layer)}</strong>
              <span class="zone-tag ${lower ? "lower" : "upper"}">${lower ? "滴釉可放" : "普通层"}</span>
              ${layerBadges}
            </div>
            <span class="layer-note">${state.kiln.locked ? "已锁定：只能补空位" : "可调整"}</span>
          </div>
          <div class="slots" style="--positions:${state.kiln.positionsPerLayer}">${slots.join("")}</div>
        </article>
      `);
    }
    els.layerList.innerHTML = layers.join("");
  }

  function renderEmptySlot(layer, position) {
    const message = state.kiln.locked
      ? `剩余空位 ${position + 1}<br><small>加件需整窑复核</small>`
      : `空位 ${position + 1}<br><small>从待烧清单选择</small>`;
    return `<div class="slot empty">${message}</div>`;
  }

  function renderOccupiedSlot(placement, layer, position) {
    const ware = getWare(placement.wareId);
    if (!ware) return renderEmptySlot(layer, position);
    const issues = lastAnalysis.byWare[ware.id] || [];
    const highest = issues.some((issue) => issue.level === "error")
      ? "has-error"
      : issues.some((issue) => issue.level === "warning")
        ? "has-warning"
        : issues.some((issue) => issue.level === "info")
          ? "has-info"
          : "";
    const riskHtml = issues.length
      ? `<div class="slot-risk">${issues.slice(0, 3).map((issue) =>
        `<p class="${issue.level === "error" ? "text-danger" : issue.level === "warning" ? "text-warning" : ""}">${escapeHtml(issue.title)}</p>`
      ).join("")}</div>`
      : `<div class="slot-risk"><p class="text-ok">未见风险</p></div>`;
    return `
      <article class="slot ${highest}">
        <span class="slot-position">${slotLabel(layer, position)}</span>
        <div class="ware-name">${escapeHtml(ware.name)}</div>
        <div class="ware-meta">
          <span class="badge ${ware.drip ? "lower" : "upper"}">${ware.drip ? "滴釉" : "不滴"}</span>
          <span class="badge info">${ware.temp}℃</span>
        </div>
        <small class="muted">${escapeHtml(ware.owner)}</small>
        ${riskHtml}
        <div class="slot-actions">
          <button type="button" data-action="remove-ware" data-ware-id="${ware.id}" ${state.kiln.locked ? "disabled" : ""}>移回待烧</button>
        </div>
      </article>
    `;
  }

  function renderWaiting() {
    const wares = waitingWares();
    if (!wares.length) {
      els.waitingList.innerHTML = `<p class="empty-note">没有待烧坯体。${state.kiln.locked ? "炉子锁定中；若有空位，新登记坯体可补入并复核。" : "可以新增坯体，或使用自动排位。"}</p>`;
      return;
    }
    els.waitingList.innerHTML = wares.map((ware) => {
      const choices = slotChoices(ware);
      const blocked = !choices.length;
      const reason = blocked ? noSlotReason(ware) : "";
      const bestIssues = choices.length ? choices[0].issues : [];
      const optionList = choices.length
        ? [
          `<option value="">选择窑位…</option>`,
          ...choices.slice(0, 30).map((choice) => {
            const warnings = choice.issues.filter((issue) => issue.level === "warning").length;
            const infos = choice.issues.filter((issue) => issue.level === "info").length;
            const note = warnings ? `｜${warnings}提醒` : infos ? `｜${infos}参考` : "｜可放";
            return `<option value="${choice.layer}-${choice.position}">${layerName(choice.layer)} ${choice.position + 1} 号位${note}</option>`;
          })
        ].join("")
        : `<option value="">${escapeHtml(reason)}</option>`;
      const bestWarning = bestIssues.find((issue) => issue.level === "warning");
      return `
        <article class="waiting-row">
          <div class="waiting-info">
            <div>
              <strong>${escapeHtml(ware.name)}</strong>
              <small>${escapeHtml(ware.owner)} · ${ware.temp}℃ · ${ware.drip ? "滴釉" : "不滴釉"}</small>
            </div>
            ${blocked ? `<span class="badge error">摆不下</span>` : ""}
            ${ware.drip ? `<span class="badge lower">需下层</span>` : ""}
            <div style="width:100%">
              ${blocked
                ? `<p class="waiting-blocked">${escapeHtml(reason)}</p>`
                : bestWarning
                  ? `<p class="waiting-warn">最佳空位仍有提醒：${escapeHtml(bestWarning.title)}</p>`
                  : `<p class="empty-note">有空位，可直接放入。</p>`}
            </div>
          </div>
          <form data-assign-form data-ware-id="${ware.id}">
            <select name="slot" ${blocked ? "disabled" : ""} aria-label="${escapeHtml(ware.name)} 的窑位">
              ${optionList}
            </select>
          </form>
          <div class="waiting-actions">
            <button type="button" data-action="delete-waiting" data-ware-id="${ware.id}" class="remove danger" ${state.kiln.locked ? "disabled" : ""}>删除</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderSettings() {
    const kiln = state.kiln;
    els.settingsCard.innerHTML = `
      <div class="card-header">
        <div>
          <p class="section-kicker">Kiln Rules</p>
          <h2>窑炉规则</h2>
        </div>
      </div>
      <form id="settingsForm" class="settings-form">
        <label>层数
          <input type="number" name="layers" min="2" max="10" value="${kiln.layers}" ${kiln.locked ? "disabled" : ""}>
        </label>
        <label>每层位置数
          <input type="number" name="positionsPerLayer" min="2" max="12" value="${kiln.positionsPerLayer}" ${kiln.locked ? "disabled" : ""}>
        </label>
        <label>滴釉下层数
          <input type="number" name="lowerLayers" min="1" max="${Math.max(1, Math.floor(kiln.layers / 2))}" value="${kiln.lowerLayers}" ${kiln.locked ? "disabled" : ""}>
        </label>
        <label>同窑温差红线 ℃
          <input type="number" name="maxKilnTempDiff" min="1" max="300" value="${kiln.maxKilnTempDiff}" ${kiln.locked ? "disabled" : ""}>
        </label>
        <label class="wide">近位互相影响温差 ℃
          <input type="number" name="nearbyTempDiff" min="1" max="200" value="${kiln.nearbyTempDiff}" ${kiln.locked ? "disabled" : ""}>
        </label>
        <p class="form-hint wide">滴釉坯只允许在最下面设定层数中无阻断；放到上层会作为明确风险标出。近位指同层相邻或上下同列/相邻位。</p>
        <div class="settings-actions">
          <button type="submit" class="primary" ${kiln.locked ? "disabled" : ""}>保存规则</button>
          <button type="button" data-action="load-sample">载入示例</button>
          <button type="button" class="danger" data-action="reset-all">清空数据</button>
        </div>
      </form>
    `;
  }

  function renderOwners() {
    const owners = new Map();
    state.wares.forEach((ware) => {
      if (!owners.has(ware.owner)) {
        owners.set(ware.owner, { total: 0, waiting: 0, placed: 0, drip: 0, temps: [] });
      }
      const stats = owners.get(ware.owner);
      stats.total += 1;
      stats.temps.push(ware.temp);
      if (ware.drip) stats.drip += 1;
      if (getPlacement(ware.id)) stats.placed += 1;
      else stats.waiting += 1;
    });

    const rows = [...owners.entries()].sort((a, b) => b[1].placed - a[1].placed || a[0].localeCompare(b[0], "zh-Hans-CN"))
      .map(([owner, stats]) => {
        const min = Math.min(...stats.temps);
        const max = Math.max(...stats.temps);
        return `
          <tr>
            <td><div class="owner-name">${escapeHtml(owner)}</div><div class="owner-sub">${stats.drip} 件滴釉</div></td>
            <td class="num">${stats.placed}</td>
            <td class="num">${stats.waiting}</td>
            <td class="num">${stats.total}</td>
            <td>${min === max ? `${min}℃` : `${min}–${max}℃`}</td>
          </tr>
        `;
      }).join("");

    els.ownersCard.innerHTML = `
      <div class="card-header">
        <div>
          <p class="section-kicker">Settlement</p>
          <h2>各人占位</h2>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>窑主</th><th class="num">已占</th><th class="num">待烧</th><th class="num">合计</th><th>温度</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">暂无坯体</td></tr>`}</tbody>
        </table>
      </div>
      <p class="form-hint">烧完开炉会按每件结果归档，历史中也按窑主分开统计坏损。</p>
    `;
  }

  function renderHistory() {
    const allResults = state.history.flatMap((batch) => batch.results);
    const bad = allResults.filter((result) => result.status === "bad").length;
    const flaw = allResults.filter((result) => result.status === "flaw").length;
    const layerCounts = damagedLayerCount();
    const layerTags = [...layerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([layer, count]) => `<span class="badge error">第 ${layer + 1} 层 ×${count}</span>`)
      .join("");

    els.historyCard.innerHTML = `
      <div class="card-header">
        <div>
          <p class="section-kicker">Firing History</p>
          <h2>坏损复盘</h2>
        </div>
        <button type="button" class="danger" data-action="clear-history" ${state.history.length ? "" : "disabled"}>清空</button>
      </div>
      <div class="risk-summary" style="grid-template-columns:repeat(3,1fr); margin-top:0;">
        <div class="risk-stat"><span>已归档炉次</span><strong>${state.history.length}</strong></div>
        <div class="risk-stat warning"><span>瑕疵</span><strong>${flaw}</strong></div>
        <div class="risk-stat error"><span>烧坏</span><strong>${bad}</strong></div>
      </div>
      <p class="form-hint"><strong>坏损高发层：</strong>${layerTags || '<span class="muted">暂无记录</span>'}</p>
      <div class="history-list">
        ${state.history.length ? state.history.slice(0, 5).map(renderHistoryBatch).join("") : `<p class="empty-note">烧完开炉后，烧坏层、位置备注和各人结果会保留在这里。</p>`}
      </div>
    `;
  }

  function renderHistoryBatch(batch) {
    const statusCounts = {
      good: batch.results.filter((result) => result.status === "good").length,
      flaw: batch.results.filter((result) => result.status === "flaw").length,
      bad: batch.results.filter((result) => result.status === "bad").length
    };
    const ownerMap = new Map();
    batch.results.forEach((result) => {
      if (!ownerMap.has(result.owner)) ownerMap.set(result.owner, { total: 0, bad: 0, flaw: 0 });
      const stats = ownerMap.get(result.owner);
      stats.total += 1;
      if (result.status === "bad") stats.bad += 1;
      if (result.status === "flaw") stats.flaw += 1;
    });
    const ownerRows = [...ownerMap.entries()].map(([owner, stats]) =>
      `<span class="badge ${stats.bad ? "error" : stats.flaw ? "warning" : "lower"}">${escapeHtml(owner)} ${stats.total} 件${stats.bad ? ` / 坏 ${stats.bad}` : stats.flaw ? ` / 瑕 ${stats.flaw}` : " / 完好"}</span>`
    ).join("");
    const damages = batch.results
      .filter((result) => result.status !== "good")
      .map((result) => `
        <div class="history-item" style="box-shadow:none; padding:9px;">
          <div class="history-head">
            <div><strong>${escapeHtml(result.wareName)}</strong><small>${escapeHtml(result.owner)} · ${result.temp}℃ · ${Number.isInteger(result.layer) ? `${slotLabel(result.layer, result.position || 0)} 号位` : "未记层位"}</small></div>
            <span class="badge ${result.status === "bad" ? "error" : "warning"}">${result.status === "bad" ? "烧坏" : "瑕疵"}</span>
          </div>
          ${result.note ? `<p class="history-notes">${escapeHtml(result.note)}</p>` : ""}
        </div>
      `).join("");
    return `
      <article class="history-item">
        <div class="history-head">
          <div><strong>${formatDate(batch.firedAt)} 开炉</strong><small>${batch.results.length} 件入档</small></div>
          <button type="button" class="danger" data-action="delete-history" data-batch-id="${batch.id}">删除</button>
        </div>
        <div class="history-results">
          <span class="badge lower">完好 ${statusCounts.good}</span>
          <span class="badge warning">瑕疵 ${statusCounts.flaw}</span>
          <span class="badge error">烧坏 ${statusCounts.bad}</span>
        </div>
        <div class="damage-layers">${ownerRows}</div>
        ${damages ? `<div class="history-list">${damages}</div>` : '<p class="empty-note">本炉全部完好。</p>'}
        ${batch.note ? `<p class="history-notes">炉次备注：${escapeHtml(batch.note)}</p>` : ""}
      </article>
    `;
  }

  function renderFiringModal() {
    const items = placedWares();
    els.firingContent.innerHTML = `
      <p class="form-hint">逐件记录烧后状态、实际所在层和原因。保存后本炉进入“坏损复盘”，窑位清空，待烧坯体保留。</p>
      <form id="firingForm">
        <div class="table-wrap">
          <table class="firing-table">
            <thead>
              <tr><th>坯体/窑主</th><th>层</th><th>结果</th><th>坏在哪里 / 备注</th></tr>
            </thead>
            <tbody>
              ${items.map(({ ware, placement }) => `
                <tr>
                  <td><strong>${escapeHtml(ware.name)}</strong><br><small class="muted">${escapeHtml(ware.owner)} · ${ware.temp}℃ · 原 ${slotLabel(placement.layer, placement.position)}</small></td>
                  <td><input type="number" name="layer-${ware.id}" min="1" max="${state.kiln.layers}" value="${placement.layer + 1}"></td>
                  <td>
                    <div class="firing-status">
                      <label><input type="radio" name="status-${ware.id}" value="good" checked> 完好</label>
                      <label><input type="radio" name="status-${ware.id}" value="flaw"> 瑕疵</label>
                      <label><input type="radio" name="status-${ware.id}" value="bad"> 烧坏</label>
                    </div>
                  </td>
                  <td><input type="text" name="note-${ware.id}" maxlength="100" placeholder="如：第 4 层靠窑门，底足落渣"></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <label class="firing-notes">整炉备注
          <textarea name="batchNote" placeholder="火温、窑位、滴釉或互相影响的复盘都可记在这里"></textarea>
        </label>
      </form>
    `;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    window.clearTimeout(ui.toastTimer);
    ui.toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function bindEvents() {
    els.addWareForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addWare(new FormData(els.addWareForm));
    });

    document.body.addEventListener("submit", (event) => {
      if (event.target.id === "settingsForm") {
        event.preventDefault();
        saveSettings(new FormData(event.target));
      }
      if (event.target.matches("[data-assign-form]")) {
        event.preventDefault();
        const form = event.target;
        const value = new FormData(form).get("slot");
        if (!value) return;
        const [layer, position] = value.split("-").map(Number);
        assignWare(form.dataset.wareId, layer, position);
      }
    });

    document.body.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === "auto-assign") autoAssign();
      if (action === "lock-kiln") lockKiln();
      if (action === "unlock-kiln") unlockKiln();
      if (action === "open-firing") openFiring();
      if (action === "close-firing") closeFiring();
      if (action === "clear-placements") clearPlacements();
      if (action === "load-sample") loadSample();
      if (action === "reset-all") resetAll();
      if (action === "clear-history") clearHistory();
      if (action === "save-firing") {
        const form = $("#firingForm");
        if (form) saveFiring(new FormData(form));
      }
      if (action === "remove-ware") removeWare(actionEl.dataset.wareId);
      if (action === "delete-waiting") deleteWare(actionEl.dataset.wareId);
      if (action === "delete-history") deleteHistoryBatch(actionEl.dataset.batchId);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.firingModal.classList.contains("hidden")) closeFiring();
    });
  }

  function fixNormalization() {
    state.placements = state.placements.filter((placement) =>
      getWare(placement.wareId) &&
      placement.layer < state.kiln.layers &&
      placement.position < state.kiln.positionsPerLayer);
  }

  bindEvents();
  fixNormalization();
  render();
})();
