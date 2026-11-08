let lastStructuralSignature = "";

document.addEventListener("DOMContentLoaded", () => {
  bindTopBarButtons();
  bindGlobalCardActions();
  renderDashboard(true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.monitors) {
      const monitors = changes.monitors.newValue || [];
      const newSig = buildStructureSignature(monitors);

      // Se apenas os segundos (remainingSec) mudaram, atualiza só os números sem recriar os botões!
      if (newSig === lastStructuralSignature) {
        updateTimersInPlace(monitors);
      } else {
        renderDashboard(true);
      }
    }
  });
});

// Assinatura estrutural para saber se algum card mudou de coluna ou se apenas o segundo descontou
function buildStructureSignature(monitors) {
  return monitors
    .map(
      (m) =>
        `${m.id}:${m.status}:${Boolean(m.alertTriggered)}:${Boolean(m.keywordMonitorPaused)}:${
          m.checks || 0
        }:${m.lastResult || ""}:${m.selector || ""}:${m.keyword || ""}:${m.condition || ""}`
    )
    .join("|");
}

function showFeedback(text, color = "#34d399") {
  const el = document.getElementById("status-feedback");
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  clearTimeout(window._dashFeedbackTimer);
  window._dashFeedbackTimer = setTimeout(() => {
    el.textContent =
      "Acompanhe em tempo real todos os elementos clicados (CSS, XPath, Links, Cores, Cards) e ciclos de reload";
    el.style.color = "";
  }, 3000);
}

function bindTopBarButtons() {
  const colBtn = document.getElementById("view-columns-btn");
  const tabBtn = document.getElementById("view-table-btn");
  const colView = document.getElementById("columns-view");
  const tabView = document.getElementById("table-view");

  // 1. Alternar para Visão em Colunas
  colBtn?.addEventListener("click", () => {
    colBtn.classList.add("active");
    tabBtn.classList.remove("active");
    colView.classList.remove("hidden");
    colView.style.display = "grid";
    tabView.classList.add("hidden");
    tabView.style.display = "none";
    showFeedback("🗂️ Alternado para Visão em Colunas");
  });

  // 2. Alternar para Visão em Tabela Completa
  tabBtn?.addEventListener("click", () => {
    tabBtn.classList.add("active");
    colBtn.classList.remove("active");
    tabView.classList.remove("hidden");
    tabView.style.display = "block";
    colView.classList.add("hidden");
    colView.style.display = "none";
    showFeedback("📋 Alternado para Visão em Tabela Completa");
  });

  // 3. Adicionar Monitor Manualmente
  document.getElementById("add-monitor-btn")?.addEventListener("click", addMonitor);

  // 4. Iniciar Todos
  document.getElementById("start-all-btn")?.addEventListener("click", () => {
    setAllStatus("running");
  });

  // 5. Parar Todos
  document.getElementById("stop-all-btn")?.addEventListener("click", () => {
    setAllStatus("paused");
  });

  // 6. Carregar Lista de Sites de Teste com 1 Clique
  document.getElementById("load-demo-btn")?.addEventListener("click", loadDemoSitesList);
}

// Delegação global de cliques para os botões dentro dos cards e da tabela (nunca perde o clique!)
function bindGlobalCardActions() {
  document.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;

    const action = actionBtn.getAttribute("data-action");
    const id = actionBtn.getAttribute("data-id");
    const url = actionBtn.getAttribute("data-url");

    if (action === "open" && url) {
      chrome.tabs.create({ url });
      return;
    }

    if (action === "delete" && id) {
      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = (data.monitors || []).filter((m) => m.id !== id);
        chrome.storage.local.set({ monitors }, () => {
          showFeedback("🗑️ Monitoramento removido com sucesso.", "#f87171");
        });
      });
      return;
    }

    if (action === "toggle" && id) {
      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = data.monitors || [];
        const item = monitors.find((m) => m.id === id);
        if (!item) return;

        const nextStatus = item.status === "running" ? "paused" : "running";
        item.status = nextStatus;
        item.keywordMonitorPaused = nextStatus === "paused";
        if (nextStatus === "paused") item.alertTriggered = false;
        item.remainingSec = item.intervalSec || 25;
        item.lastResult =
          nextStatus === "running" ? "🟢 Iniciado pelo Dashboard" : "⏸ Pausado pelo Dashboard";

        chrome.storage.local.set({ monitors }, () => {
          chrome.runtime.sendMessage({
            action: "sync-monitor-state",
            tabId: item.tabId,
            clearHighlights: nextStatus === "paused",
            runImmediateInspect: nextStatus === "running",
            monitor: item
          });
          showFeedback(
            nextStatus === "running"
              ? `▶ Monitoramento "${item.name}" iniciado!`
              : `⏹ Monitoramento "${item.name}" pausado!`,
            nextStatus === "running" ? "#34d399" : "#f87171"
          );
        });
      });
    }
  });
}

function loadDemoSitesList() {
  const demoMonitors = [
    {
      id: "demo-books-" + Date.now(),
      name: "Books to Scrape (Catálogo de Cards)",
      url: "https://books.toscrape.com/",
      selector: "article.product_pod",
      condition: "found",
      keyword: "In stock",
      capturedTag: "article",
      capturedColor: "rgb(16, 185, 129)",
      capturedColorName: "Verde",
      cardsCount: 20,
      intervalSec: 20,
      remainingSec: 20,
      antiBlockJitter: true,
      pauseOnCaptcha: true,
      stealthMode: false,
      keywordMonitorPaused: false,
      alertTriggered: false,
      stopOnTrigger: false,
      status: "paused",
      checks: 0,
      lastResult: "Pronto para testar (Clique em ▶ Iniciar ou ↗ Abrir Aba)"
    },
    {
      id: "demo-github-" + (Date.now() + 1),
      name: "GitHub Status (Monitor de Cor/Status)",
      url: "https://www.githubstatus.com/",
      selector: ".page-status",
      condition: "color_change",
      keyword: "Verde",
      capturedTag: "div",
      capturedColor: "rgb(40, 167, 69)",
      capturedColorName: "Verde",
      cardsCount: 1,
      intervalSec: 25,
      remainingSec: 25,
      antiBlockJitter: true,
      pauseOnCaptcha: true,
      stealthMode: false,
      keywordMonitorPaused: false,
      alertTriggered: false,
      stopOnTrigger: false,
      status: "paused",
      checks: 0,
      lastResult: "Vigiar mudança de cor do status"
    },
    {
      id: "demo-hn-" + (Date.now() + 2),
      name: "Hacker News (Lista de Cards/Notícias)",
      url: "https://news.ycombinator.com/",
      selector: "tr.athing",
      condition: "cards_change",
      keyword: "",
      capturedTag: "tr",
      capturedColor: "rgb(255, 102, 0)",
      capturedColorName: "Amarelo/Laranja",
      cardsCount: 30,
      intervalSec: 30,
      remainingSec: 30,
      antiBlockJitter: true,
      pauseOnCaptcha: true,
      stealthMode: false,
      keywordMonitorPaused: false,
      alertTriggered: false,
      stopOnTrigger: false,
      status: "paused",
      checks: 0,
      lastResult: "Vigiar alteração de cards na lista"
    }
  ];

  chrome.storage.local.get(["monitors"], (data) => {
    const existing = data.monitors || [];
    const combined = [...existing, ...demoMonitors];
    chrome.storage.local.set({ monitors: combined }, () => {
      showFeedback("🧪 3 Sites de Lista adicionados! Clique em '↗ Abrir Aba' e depois em '▶ Iniciar'.");
    });
  });
}

function addMonitor() {
  const name = document.getElementById("m-name").value.trim();
  let url = document.getElementById("m-url").value.trim();
  const selector = document.getElementById("m-selector").value.trim();
  const condition = document.getElementById("m-condition").value;
  const keyword = document.getElementById("m-keyword").value.trim();
  const intervalSec = Number(document.getElementById("m-interval").value) || 25;

  if (!url) {
    showFeedback("⚠️ Digite uma URL no campo 'URL da Página' (ex: https://books.toscrape.com)", "#f87171");
    document.getElementById("m-url").focus();
    return;
  }

  // Se o usuário digitou sem https://, adiciona automaticamente
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const newMonitor = {
    id: Date.now().toString(),
    name: name || url,
    url,
    selector,
    condition,
    keyword,
    intervalSec,
    remainingSec: intervalSec,
    antiBlockJitter: true,
    pauseOnCaptcha: true,
    stealthMode: false,
    keywordMonitorPaused: false,
    alertTriggered: false,
    stopOnTrigger: false,
    status: "running",
    checks: 0,
    lastResult: "Adicionado pelo Painel (Aba aberta)"
  };

  chrome.storage.local.get(["monitors"], (data) => {
    const monitors = data.monitors || [];
    monitors.push(newMonitor);
    chrome.storage.local.set({ monitors }, () => {
      chrome.runtime.sendMessage({ action: "open-monitor-tab", url: newMonitor.url });
      document.getElementById("m-name").value = "";
      document.getElementById("m-url").value = "";
      document.getElementById("m-selector").value = "";
      document.getElementById("m-keyword").value = "";
      showFeedback(`✅ Site "${newMonitor.name}" adicionado e iniciado!`);
    });
  });
}

function formatConditionLabel(cond) {
  if (cond === "color_change") return "🎨 Mudança de Cor";
  if (cond === "cards_change") return "🗂️ Alteração de Card";
  if (cond === "lost") return "🚫 Sumir da Página";
  return "🔍 Aparecer na Página";
}

// Atualiza apenas o texto dos contadores a cada segundo sem destruir os botões!
function updateTimersInPlace(monitors) {
  monitors.forEach((m) => {
    const isRunning = m.status === "running";
    const checks = m.checks || 0;
    const remSec = m.remainingSec ?? m.intervalSec ?? 25;
    const timerText = isRunning ? `⏱️ ${remSec}s (#${checks})` : `⏸ Parado (#${checks})`;

    document.querySelectorAll(`[data-timer-id="${m.id}"]`).forEach((el) => {
      el.textContent = timerText;
    });
  });
}

function renderDashboard() {
  chrome.storage.local.get(["monitors"], (data) => {
    const monitors = data.monitors || [];
    lastStructuralSignature = buildStructureSignature(monitors);

    const runningList = document.getElementById("list-running");
    const triggeredList = document.getElementById("list-triggered");
    const pausedList = document.getElementById("list-paused");
    const tbody = document.getElementById("watchlist-tbody");

    runningList.innerHTML = "";
    triggeredList.innerHTML = "";
    pausedList.innerHTML = "";
    tbody.innerHTML = "";

    let cRunning = 0;
    let cTriggered = 0;
    let cPaused = 0;
    let totalChecksSum = 0;

    monitors.forEach((m) => {
      const checks = m.checks || 0;
      totalChecksSum += checks;

      const isRunning = m.status === "running";
      const isAlerting = Boolean(isRunning && m.alertTriggered && !m.keywordMonitorPaused);
      const remSec = m.remainingSec ?? m.intervalSec ?? 25;

      const timerText = isRunning ? `⏱️ ${remSec}s (#${checks})` : `⏸ Parado (#${checks})`;
      const tagBadge = m.capturedTag ? `<${m.capturedTag}> ` : "";
      const selectorText = m.selector || "Página inteira (body)";
      const colorRaw = m.capturedColor || "#64748b";
      const colorName = m.capturedColorName || "Padrão";
      const cardsCount = m.cardsCount ?? 0;

      const hrefRow = m.capturedHref
        ? `<div class="meta-row"><span>🔗 Link clicado:</span> <a class="card-url" style="margin:0; max-width:190px;" href="${m.capturedHref}" target="_blank" rel="noopener">${m.capturedHref.slice(0, 38)}...</a></div>`
        : "";

      const card = document.createElement("div");
      card.className = `monitor-card ${isAlerting ? "card-triggered" : ""}`;

      card.innerHTML = `
        <div class="card-top">
          <div class="card-title">${m.name || m.url}</div>
          <span class="card-timer-pill" data-timer-id="${m.id}">${timerText}</span>
        </div>
        <a class="card-url" href="${m.url}" target="_blank" rel="noopener">${m.url}</a>

        <div class="card-meta-box">
          <div class="meta-row">
            <span>🎯 Captura:</span>
            <span class="code-tag">${tagBadge}${selectorText.slice(0, 34)}</span>
          </div>
          ${hrefRow}
          <div class="meta-row">
            <span>🎨 Cor / Cards:</span>
            <span><i class="color-dot" style="background:${colorRaw};"></i><b>${colorName}</b> • 🗂️ ${cardsCount} cards</span>
          </div>
          <div class="meta-row">
            <span>⚡ Regra:</span>
            <span>${formatConditionLabel(m.condition)} (<b>${m.keyword || "Geral"}</b>)</span>
          </div>
        </div>

        <div class="card-log ${isAlerting ? "alert" : ""}">
          📋 ${m.lastResult || "Aguardando primeira leitura..."}
        </div>

        <div class="card-actions">
          <button type="button" class="${isRunning ? "btn-danger" : "btn-success"}" data-action="toggle" data-id="${m.id}">
            ${isRunning ? "⏹ Parar" : "▶ Iniciar"}
          </button>
          <button type="button" class="btn-secondary" data-action="open" data-url="${m.url}">↗ Abrir Aba</button>
          <button type="button" class="btn-danger btn-icon-only" data-action="delete" data-id="${m.id}" title="Excluir">🗑️</button>
        </div>
      `;

      if (isAlerting) {
        cTriggered++;
        cRunning++;
        triggeredList.appendChild(card);
      } else if (isRunning) {
        cRunning++;
        runningList.appendChild(card);
      } else {
        cPaused++;
        pausedList.appendChild(card);
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${isAlerting ? "🚨 ALERTA!" : isRunning ? "🟢 Ativo" : "⏸ Parado"}</b><br><small data-timer-id="${m.id}">${timerText}</small></td>
        <td><strong>${m.name}</strong><br><a class="card-url" href="${m.url}" target="_blank" rel="noopener">${m.url}</a></td>
        <td><span class="code-tag">${tagBadge}${selectorText}</span>${m.xpath ? `<br><small style="color:#64748b;">${m.xpath.slice(0, 40)}...</small>` : ""}</td>
        <td><i class="color-dot" style="background:${colorRaw};"></i>${colorName}<br><small>🗂️ ${cardsCount} cards</small></td>
        <td>${formatConditionLabel(m.condition)}<br><b>Alvo: ${m.keyword || "Qualquer"}</b></td>
        <td><b>${checks}</b><br><small>Base: ${m.intervalSec}s</small></td>
        <td style="color:${isAlerting ? "#fde047" : "#cbd5e1"};">${m.lastResult || "-"}</td>
        <td>
          <button type="button" class="${isRunning ? "btn-danger" : "btn-success"}" data-action="toggle" data-id="${m.id}">
            ${isRunning ? "⏹" : "▶"}
          </button>
          <button type="button" class="btn-danger" data-action="delete" data-id="${m.id}">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("kpi-total").textContent = monitors.length;
    document.getElementById("kpi-running").textContent = cRunning;
    document.getElementById("kpi-alerts").textContent = cTriggered;
    document.getElementById("kpi-checks").textContent = totalChecksSum;

    document.getElementById("count-running").textContent = runningList.children.length;
    document.getElementById("count-triggered").textContent = cTriggered;
    document.getElementById("count-paused").textContent = cPaused;
  });
}

function setAllStatus(status) {
  chrome.storage.local.get(["monitors"], (data) => {
    const currentList = data.monitors || [];
    if (currentList.length === 0) {
      showFeedback(
        "⚠️ Nenhum site na lista ainda! Clique em '🧪 Carregar Lista de Teste' no topo para testar.",
        "#fde047"
      );
      return;
    }

    const monitors = currentList.map((m) => ({
      ...m,
      status,
      keywordMonitorPaused: status === "paused",
      alertTriggered: status === "paused" ? false : m.alertTriggered,
      remainingSec: m.intervalSec || 25,
      lastResult: status === "running" ? "🟢 Iniciado em lote" : "⏹ Parado em lote"
    }));

    chrome.storage.local.set({ monitors }, () => {
      showFeedback(
        status === "running"
          ? `▶ Todos os ${monitors.length} monitoramentos foram iniciados!`
          : `⏹ Todos os ${monitors.length} monitoramentos foram parados!`,
        status === "running" ? "#34d399" : "#f87171"
      );
    });
  });
}