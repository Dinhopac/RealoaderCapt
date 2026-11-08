let activeTab = null;
let currentPopupMonitor = null;
let uiClockInterval = null;
let isReloadingCycle = false;

const SVG_PLAY = `<path d="M8 5v14l11-7z"/>`;
const SVG_STOP = `<path d="M6 6h12v12H6z"/>`;

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  setupCollapsibleTabs();
  bindPlayerAndActionEvents();
  renderPopupKeywordDropdown();
  loadPopupData(true);
  startLivePopupClock();

  chrome.storage.onChanged.addListener(() => {
    loadPopupData(false);
    renderPopupKeywordDropdown();
  });
});

function getPageKey(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.origin}${u.pathname}`;
  } catch {
    return (urlStr || "").split("#")[0];
  }
}

function isSamePage(urlA, urlB) {
  if (!urlA || !urlB) return false;
  const cleanA = urlA.split("#")[0];
  const cleanB = urlB.split("#")[0];
  return cleanA === cleanB || cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA);
}

function formatTimeMMSS(totalSeconds) {
  const sec = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function renderTimerDigits(seconds) {
  const timerEl = document.getElementById("scheduled-timer");
  if (timerEl) {
    timerEl.textContent = formatTimeMMSS(seconds);
  }
}

function getExactRemainingSeconds(mon) {
  if (!mon) {
    return Number(document.getElementById("intervalSec")?.value) || 25;
  }
  if (mon.status === "running" && mon.nextReloadAt) {
    return Math.max(0, Math.ceil((mon.nextReloadAt - Date.now()) / 1000));
  }
  return Number(mon.intervalSec) || 25;
}

function playPopupSoundPreview(soundType = "chime") {
  if (soundType === "mute") return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (soundType === "siren") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.linearRampToValueAtTime(980, now + 0.25);
      osc.frequency.linearRampToValueAtTime(620, now + 0.5);
      osc.frequency.linearRampToValueAtTime(980, now + 0.75);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.85);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.85);
      return;
    }

    if (soundType === "radar") {
      [0, 0.18, 0.36].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1480, now + offset);
        gain.gain.setValueAtTime(0.22, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.008, now + offset + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.15);
      });
      return;
    }

    if (soundType === "arcade") {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.14, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + (idx + 1) * 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + (idx + 1) * 0.08);
      });
      return;
    }

    if (soundType === "urgent") {
      [0, 0.12, 0.24].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(1020, now + offset);
        gain.gain.setValueAtTime(0.25, now + offset);
        gain.gain.setValueAtTime(0.01, now + offset + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.09);
      });
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1174.66, now + 0.15);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
  } catch {
    // Ignorado caso áudio não esteja disponível
  }
}

function startLivePopupClock() {
  if (uiClockInterval) clearInterval(uiClockInterval);

  uiClockInterval = setInterval(() => {
    if (!currentPopupMonitor || currentPopupMonitor.status !== "running") return;

    const rem = getExactRemainingSeconds(currentPopupMonitor);
    renderTimerDigits(rem);

    if (rem <= 0 && !isReloadingCycle) {
      isReloadingCycle = true;
      const nextSec = Number(currentPopupMonitor.intervalSec) || 25;
      const newNextReloadAt = Date.now() + nextSec * 1000;
      const newChecks = (currentPopupMonitor.checks || 0) + 1;

      currentPopupMonitor.nextReloadAt = newNextReloadAt;
      currentPopupMonitor.remainingSec = nextSec;
      currentPopupMonitor.checks = newChecks;

      renderTimerDigits(nextSec);
      const countEl = document.getElementById("reload-count-label");
      if (countEl) countEl.textContent = `• ${newChecks} ciclos`;

      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = data.monitors || [];
        const idx = findCurrentMonitorIndex(monitors);
        if (idx > -1) {
          monitors[idx].nextReloadAt = newNextReloadAt;
          monitors[idx].remainingSec = nextSec;
          monitors[idx].checks = newChecks;
          monitors[idx].lastChecked = new Date().toLocaleTimeString();
        }
        chrome.storage.local.set({ monitors }, () => {
          if (activeTab?.id) {
            if (currentPopupMonitor.stealthMode) {
              chrome.tabs
                .sendMessage(activeTab.id, {
                  action: "run-stealth-check",
                  monitor: currentPopupMonitor
                })
                .catch(() => {});
            } else {
              chrome.tabs.reload(activeTab.id);
            }
          }
          setTimeout(() => {
            isReloadingCycle = false;
          }, 800);
        });
      });
    }
  }, 250);
}

function setupCollapsibleTabs() {
  const btnReloader = document.getElementById("tab-btn-reloader");
  const btnMonitor = document.getElementById("tab-btn-monitor");
  const paneReloader = document.getElementById("tab-reloader");
  const paneMonitor = document.getElementById("tab-monitor");

  btnReloader?.addEventListener("click", () => {
    const isAlreadyOpen = paneReloader.classList.contains("active");
    if (isAlreadyOpen) {
      btnReloader.classList.remove("active");
      paneReloader.classList.remove("active");
    } else {
      btnReloader.classList.add("active");
      btnMonitor.classList.remove("active");
      paneReloader.classList.add("active");
      paneMonitor.classList.remove("active");
    }
  });

  btnMonitor?.addEventListener("click", () => {
    const isAlreadyOpen = paneMonitor.classList.contains("active");
    if (isAlreadyOpen) {
      btnMonitor.classList.remove("active");
      paneMonitor.classList.remove("active");
    } else {
      btnMonitor.classList.add("active");
      btnReloader.classList.remove("active");
      paneMonitor.classList.add("active");
      paneReloader.classList.remove("active");
    }
  });
}

async function triggerDirectPageCapture() {
  if (!activeTab?.id || !activeTab.url || !activeTab.url.startsWith("http")) return;

  chrome.tabs.sendMessage(activeTab.id, { action: "start-element-picker" }, async () => {
    if (chrome.runtime.lastError) {
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: activeTab.id },
          files: ["css/button.css"]
        });
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ["js/content.js"]
        });
      } catch {
        // Ignorado em páginas restritas
      }
      setTimeout(() => {
        chrome.tabs.sendMessage(activeTab.id, { action: "start-element-picker" }, () =>
          window.close()
        );
      }, 80);
    } else {
      window.close();
    }
  });
}

function handlePlusCaptureOrAddTerm() {
  const kwInput = document.getElementById("keyword");
  const selInput = document.getElementById("selector");
  const condInput = document.getElementById("condition");
  const typedWord = kwInput?.value.trim() || "";

  if (typedWord) {
    addTargetToCurrentMonitor(
      {
        id: Date.now().toString(),
        label: typedWord,
        keyword: typedWord,
        selector: selInput?.value.trim() || currentPopupMonitor?.selector || "",
        capturedColor: currentPopupMonitor?.capturedColor || "",
        capturedColorName: currentPopupMonitor?.capturedColorName || "",
        condition: condInput?.value || "color_or_word"
      },
      () => {
        kwInput.value = "";
      }
    );
  } else {
    triggerDirectPageCapture();
  }
}

function autoSaveMonitorFields() {
  if (!activeTab?.url || !activeTab.url.startsWith("http")) return;
  const config = getFormConfig();
  chrome.storage.local.set({ defaultInterval: config.intervalSec });
  saveOrUpdateCurrentTabMonitor({
    ...config,
    remainingSec: config.intervalSec,
    nextReloadAt: Date.now() + config.intervalSec * 1000,
    keywordMonitorPaused: false,
    stopOnTrigger: false
  });
}

function updateDarkModeUI(isDark) {
  const darkBtn = document.getElementById("dark-mode-btn");
  const darkChk = document.getElementById("pageDarkMode");
  if (darkBtn) {
    darkBtn.classList.toggle("dark-active", Boolean(isDark));
  }
  if (darkChk) {
    darkChk.checked = Boolean(isDark);
  }
}

function togglePageDarkMode(forcedValue) {
  if (!activeTab?.url || !activeTab.url.startsWith("http")) return;
  const pageKey = getPageKey(activeTab.url);

  chrome.storage.local.get(["darkModeByUrl", "monitors"], async (data) => {
    const darkMap = data.darkModeByUrl || {};
    const monitors = data.monitors || [];
    const idx = findCurrentMonitorIndex(monitors);

    const currentDark = Boolean(darkMap[pageKey] ?? (idx > -1 ? monitors[idx].darkMode : false));
    const nextDark = typeof forcedValue === "boolean" ? forcedValue : !currentDark;

    darkMap[pageKey] = nextDark;
    if (idx > -1) {
      monitors[idx].darkMode = nextDark;
    }

    chrome.storage.local.set({ darkModeByUrl: darkMap, monitors }, async () => {
      updateDarkModeUI(nextDark);
      if (activeTab?.id) {
        chrome.tabs.sendMessage(
          activeTab.id,
          { action: "set-tab-dark-mode", enableDark: nextDark },
          async () => {
            if (chrome.runtime.lastError) {
              try {
                await chrome.scripting.insertCSS({
                  target: { tabId: activeTab.id },
                  files: ["css/button.css"]
                });
                await chrome.scripting.executeScript({
                  target: { tabId: activeTab.id },
                  files: ["js/content.js"]
                });
              } catch {
                // Ignorado em páginas internas
              }
            }
          }
        );
      }
    });
  });
}

// Divide frases capturadas em palavras individuais para o usuário clicar nas palavras da frase!
function renderSentenceWordsPicker(sentenceText, monitor) {
  const wrap = document.getElementById("sentence-words-container");
  const box = document.getElementById("sentence-words-box");
  if (!wrap || !box) return;

  const rawSentence = (sentenceText || monitor?.lastCapturedSentence || monitor?.keyword || "").trim();
  const words = rawSentence
    .split(/[\s,.;:!?()[\]"'«»“”/-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

  // Só exibe o seletor de palavras da frase se houver mais de 1 palavra
  if (words.length <= 1) {
    wrap.style.display = "none";
    return;
  }

  const uniqueWords = [...new Set(words)];
  wrap.style.display = "block";
  box.innerHTML = uniqueWords
    .map((w) => `<span class="word-token" data-pick-word="${w}" title="Monitorar a palavra '${w}' e a cor deste elemento">+ ${w}</span>`)
    .join("");

  box.querySelectorAll("[data-pick-word]").forEach((tokenEl) => {
    tokenEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const chosenWord = tokenEl.getAttribute("data-pick-word");
      document.getElementById("keyword").value = chosenWord;
      addTargetToCurrentMonitor({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 4),
        label: chosenWord,
        keyword: chosenWord,
        selector: document.getElementById("selector").value.trim() || monitor?.selector || "",
        capturedColor: monitor?.capturedColor || "",
        capturedColorName: monitor?.capturedColorName || "",
        condition: document.getElementById("condition").value || "color_or_word"
      });
    });
  });
}

function bindPlayerAndActionEvents() {
  document.getElementById("toggle-btn")?.addEventListener("click", () => {
    if (!activeTab?.url) return;
    const config = getFormConfig();

    chrome.storage.local.get(["monitors"], (data) => {
      const monitors = data.monitors || [];
      const idx = findCurrentMonitorIndex(monitors);
      const isCurrentlyRunning = idx > -1 && monitors[idx].status === "running";
      const nextStatus = isCurrentlyRunning ? "paused" : "running";

      const updatedMon = upsertMonitorInList(monitors, idx, {
        ...config,
        tabId: activeTab.id,
        remainingSec: config.intervalSec,
        nextReloadAt: Date.now() + config.intervalSec * 1000,
        keywordMonitorPaused: nextStatus === "paused",
        alertTriggered: false,
        stopOnTrigger: false,
        status: nextStatus,
        lastResult:
          nextStatus === "running" ? "🟢 Rodando em Background" : "⏸ Pausado pelo Player"
      });

      currentPopupMonitor = updatedMon;

      chrome.storage.local.set({ monitors }, () => {
        chrome.runtime
          .sendMessage({
            action: "sync-monitor-state",
            tabId: activeTab.id,
            clearHighlights: nextStatus === "paused",
            runImmediateInspect: nextStatus === "running",
            monitor: updatedMon
          })
          .catch(() => {});
        updatePlayerUI(nextStatus, config.intervalSec, false);
      });
    });
  });

  document.getElementById("reload-now-btn")?.addEventListener("click", () => {
    if (activeTab?.id) chrome.tabs.reload(activeTab.id);
  });

  document.getElementById("dark-mode-btn")?.addEventListener("click", () => {
    togglePageDarkMode();
  });

  document.getElementById("pageDarkMode")?.addEventListener("change", (e) => {
    togglePageDarkMode(e.target.checked);
  });

  document.getElementById("showFloatingWidget")?.addEventListener("change", (e) => {
    chrome.storage.local.set({ showFloatingWidget: e.target.checked });
  });

  document.getElementById("open-dashboard")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  ["intervalSec", "minSec", "maxSec", "antiBlockJitter", "stealthMode", "pauseOnCaptcha"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("change", autoSaveMonitorFields);
    }
  );

  document.getElementById("intervalSec")?.addEventListener("input", (e) => {
    const val = Number(e.target.value) || 1;
    renderTimerDigits(val);
  });

  // Botões ➕ acionam a captura direta na página ou incluem a palavra digitada
  document
    .getElementById("add-kw-preset-btn")
    ?.addEventListener("click", triggerDirectPageCapture);
  document
    .getElementById("add-term-plus-btn")
    ?.addEventListener("click", handlePlusCaptureOrAddTerm);

  document.getElementById("accumulated-chips")?.addEventListener("click", (e) => {
    if (!e.target.closest("[data-del-idx]")) {
      triggerDirectPageCapture();
    }
  });

  document.getElementById("selector")?.addEventListener("change", autoSaveMonitorFields);
  document.getElementById("keyword")?.addEventListener("change", autoSaveMonitorFields);
  document.getElementById("condition")?.addEventListener("change", autoSaveMonitorFields);

  document.getElementById("soundType")?.addEventListener("change", (e) => {
    playPopupSoundPreview(e.target.value);
    autoSaveMonitorFields();
  });

  document.getElementById("test-sound-btn")?.addEventListener("click", () => {
    const currentSound = document.getElementById("soundType")?.value || "chime";
    playPopupSoundPreview(currentSound);
  });

  document.getElementById("keyword-dropdown")?.addEventListener("change", (e) => {
    const selectedVal = e.target.value;
    if (!selectedVal) return;

    chrome.storage.local.get(["capturedPresetsMap"], (data) => {
      const map = data.capturedPresetsMap || {};
      if (map[selectedVal]) {
        const item = map[selectedVal];
        document.getElementById("selector").value = item.selector || "";
        document.getElementById("keyword").value = item.keyword || selectedVal;
        if (item.condition) document.getElementById("condition").value = item.condition;
        renderSentenceWordsPicker(selectedVal, currentPopupMonitor);
        addTargetToCurrentMonitor({
          id: Date.now().toString(),
          label: selectedVal,
          keyword: item.keyword || selectedVal,
          selector: item.selector || "",
          capturedColor: item.capturedColor || "",
          capturedColorName: item.capturedColorName || "",
          condition: item.condition || "color_or_word"
        });
      } else {
        document.getElementById("keyword").value = selectedVal;
        renderSentenceWordsPicker(selectedVal, currentPopupMonitor);
        addTargetToCurrentMonitor({
          id: Date.now().toString(),
          label: selectedVal,
          keyword: selectedVal,
          selector: document.getElementById("selector").value.trim(),
          condition: document.getElementById("condition").value
        });
      }
      autoSaveMonitorFields();
    });
  });

  document.getElementById("del-kw-preset-btn")?.addEventListener("click", () => {
    document.getElementById("keyword").value = "";
    document.getElementById("selector").value = "";
    const wrap = document.getElementById("sentence-words-container");
    if (wrap) wrap.style.display = "none";

    chrome.storage.local.get(["monitors"], (data) => {
      const monitors = data.monitors || [];
      const idx = findCurrentMonitorIndex(monitors);
      if (idx > -1) {
        monitors[idx].targets = [];
        monitors[idx].keyword = "";
        monitors[idx].selector = "";
        monitors[idx].xpath = "";
        monitors[idx].lastCapturedSentence = "";
        monitors[idx].alertTriggered = false;
        monitors[idx].lastResult = "🗑️ Toda a lista acumulada foi apagada";
      }

      chrome.storage.local.set(
        {
          monitors,
          keywordPresets: [],
          capturedPresetsMap: {}
        },
        () => {
          if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, { action: "clear-highlights" }).catch(() => {});
          }
          renderPopupKeywordDropdown();
          loadPopupData(false);
        }
      );
    });
  });
}

function addTargetToCurrentMonitor(newTarget, callback) {
  if (!activeTab?.url) {
    if (callback) callback();
    return;
  }
  chrome.storage.local.get(["monitors", "keywordPresets"], (data) => {
    const monitors = data.monitors || [];
    const presets = Array.isArray(data.keywordPresets) ? data.keywordPresets : [];
    if (newTarget.label && !presets.includes(newTarget.label)) {
      presets.unshift(newTarget.label);
    }

    const idx = findCurrentMonitorIndex(monitors);
    const current = upsertMonitorInList(monitors, idx, {});
    const targets = Array.isArray(current.targets) ? current.targets : [];

    if (!targets.some((t) => t.label === newTarget.label && t.selector === newTarget.selector)) {
      targets.push(newTarget);
    }
    current.targets = targets;
    current.keyword = newTarget.keyword || current.keyword;
    current.selector = newTarget.selector || current.selector;

    chrome.storage.local.set({ monitors, keywordPresets: presets }, () => {
      loadPopupData(false);
      if (callback) callback();
    });
  });
}

function renderAccumulatedChips(monitor) {
  const container = document.getElementById("accumulated-chips");
  if (!container) return;

  const targets = Array.isArray(monitor?.targets) ? [...monitor.targets] : [];

  if (targets.length === 0 && (monitor?.selector || monitor?.keyword)) {
    targets.push({
      label: monitor.keyword || monitor.selector,
      selector: monitor.selector || "",
      capturedColor: monitor.capturedColor || "",
      capturedColorName: monitor.capturedColorName || "",
      condition: monitor.condition || "color_or_word"
    });
  }

  if (targets.length === 0) {
    container.innerHTML = `<span style="font-size:11px; color:#94a3b8;">Nenhum alvo acumulado ainda. Clique em <b>➕</b> para coletar!</span>`;
    return;
  }

  container.innerHTML = targets
    .map((t, i) => {
      const swatch = t.capturedColor
        ? `<span class="color-dot" style="background:${t.capturedColor};" title="Cor base: ${t.capturedColorName || t.capturedColor}"></span>`
        : `<b>🎯</b>`;
      return `
      <span class="target-chip">
        ${swatch}
        <span>${(t.label || t.keyword || t.selector || "Item").slice(0, 22)}</span>
        <span class="chip-del" data-del-idx="${i}" title="Remover este alvo">×</span>
      </span>`;
    })
    .join("");

  container.querySelectorAll("[data-del-idx]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const delIdx = Number(btn.getAttribute("data-del-idx"));
      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = data.monitors || [];
        const mIdx = findCurrentMonitorIndex(monitors);
        if (mIdx > -1) {
          if (Array.isArray(monitors[mIdx].targets) && monitors[mIdx].targets.length > 0) {
            monitors[mIdx].targets.splice(delIdx, 1);
          } else {
            monitors[mIdx].selector = "";
            monitors[mIdx].keyword = "";
          }
          chrome.storage.local.set({ monitors });
        }
      });
    });
  });
}

function findCurrentMonitorIndex(monitors) {
  if (!activeTab?.url) return -1;
  let idx = monitors.findIndex(
    (m) => m.tabId === activeTab.id && isSamePage(activeTab.url, m.url)
  );
  if (idx === -1) {
    idx = monitors.findIndex((m) => isSamePage(activeTab.url, m.url));
  }
  return idx;
}

function upsertMonitorInList(monitors, idx, patch) {
  if (idx > -1) {
    Object.assign(monitors[idx], { ...patch, tabId: activeTab.id, url: activeTab.url });
    return monitors[idx];
  }
  const newMon = {
    id: Date.now().toString(),
    tabId: activeTab.id,
    name: activeTab.title || new URL(activeTab.url).hostname,
    url: activeTab.url,
    intervalSec: 25,
    remainingSec: 25,
    condition: "color_or_word",
    soundType: "chime",
    targets: [],
    status: "paused",
    checks: 0,
    ...patch
  };
  monitors.push(newMon);
  return newMon;
}

function saveOrUpdateCurrentTabMonitor(patch, callback) {
  if (!activeTab?.url) return;
  chrome.storage.local.get(["monitors"], (data) => {
    const monitors = data.monitors || [];
    const idx = findCurrentMonitorIndex(monitors);
    const updated = upsertMonitorInList(monitors, idx, patch);
    chrome.storage.local.set({ monitors }, () => {
      if (callback) callback(updated);
    });
  });
}

function renderPopupKeywordDropdown() {
  const dropdown = document.getElementById("keyword-dropdown");
  const kwInput = document.getElementById("keyword");
  if (!dropdown) return;

  chrome.storage.local.get(["keywordPresets", "capturedPresetsMap"], (data) => {
    const list = Array.isArray(data.keywordPresets) ? data.keywordPresets : [];
    const map = data.capturedPresetsMap || {};
    const currentVal = kwInput?.value.trim() || "";

    dropdown.innerHTML = [
      `<option value="">-- Lista Acumulada (${list.length} itens) --</option>`,
      ...(list.length > 0
        ? [
            `<option value="@TODAS" ${currentVal === "@TODAS" ? "selected" : ""}>📚 Monitorar TODAS da lista (${list.length})</option>`
          ]
        : []),
      ...list.map((w) => {
        const colorName = map[w]?.capturedColorName ? ` • Cor: ${map[w].capturedColorName}` : "";
        return `<option value="${w}" ${w === currentVal ? "selected" : ""}>🎯 ${w}${colorName}</option>`;
      })
    ].join("");
  });
}

function loadPopupData(fillInputs = false) {
  chrome.storage.local.get(
    ["monitors", "defaultInterval", "showFloatingWidget", "darkModeByUrl"],
    (data) => {
      const monitors = data.monitors || [];
      const fallbackSec = data.defaultInterval || 25;
      const darkMap = data.darkModeByUrl || {};

      const widgetChk = document.getElementById("showFloatingWidget");
      if (widgetChk) widgetChk.checked = data.showFloatingWidget !== false;

      if (!activeTab?.url) {
        renderTimerDigits(fallbackSec);
        return;
      }

      const pageKey = getPageKey(activeTab.url);
      const idx = findCurrentMonitorIndex(monitors);
      const current = idx > -1 ? monitors[idx] : null;
      currentPopupMonitor = current;

      const isTabDark = Boolean(darkMap[pageKey] ?? current?.darkMode);
      updateDarkModeUI(isTabDark);

      if (current) {
        if (fillInputs) {
          document.getElementById("intervalSec").value = current.intervalSec || 25;
          document.getElementById("minSec").value = current.minSec || "";
          document.getElementById("maxSec").value = current.maxSec || "";
          document.getElementById("keyword").value = current.keyword || "";
          document.getElementById("condition").value = current.condition || "color_or_word";
          document.getElementById("selector").value = current.selector || "";
          document.getElementById("soundType").value = current.soundType || "chime";
          document.getElementById("antiBlockJitter").checked = Boolean(current.antiBlockJitter);
          document.getElementById("stealthMode").checked = Boolean(current.stealthMode);
          document.getElementById("pauseOnCaptcha").checked = current.pauseOnCaptcha !== false;
          renderPopupKeywordDropdown();
        }

        const soundSelect = document.getElementById("soundType");
        if (soundSelect && current.soundType) {
          soundSelect.value = current.soundType;
        }

        renderSentenceWordsPicker(current.lastCapturedSentence || current.keyword, current);
        renderAccumulatedChips(current);
        document.getElementById("reload-count-label").textContent =
          `• ${current.checks || 0} ciclos`;

        const displaySec = getExactRemainingSeconds(current);

        updatePlayerUI(
          current.status,
          displaySec,
          Boolean(current.alertTriggered && !current.keywordMonitorPaused)
        );
      } else {
        if (fillInputs) {
          document.getElementById("intervalSec").value = fallbackSec;
          document.getElementById("antiBlockJitter").checked = false;
        }
        renderAccumulatedChips(null);
        updatePlayerUI("paused", fallbackSec, false);
      }
    }
  );
}

function updatePlayerUI(status, secondsToDisplay, isAlertActive) {
  const toggleBtn = document.getElementById("toggle-btn");
  const playIcon = document.getElementById("play-icon");
  const badge = document.getElementById("status-badge");
  const timerDigits = document.getElementById("scheduled-timer");

  renderTimerDigits(secondsToDisplay);

  if (status === "running") {
    toggleBtn.classList.add("running");
    playIcon.innerHTML = SVG_STOP;
    timerDigits.classList.add("running");

    if (isAlertActive) {
      badge.textContent = "🚨 ALERTA ATIVO";
      badge.className = "status-pill";
    } else {
      badge.textContent = "🟢 ATIVO";
      badge.className = "status-pill active";
    }
  } else {
    toggleBtn.classList.remove("running");
    playIcon.innerHTML = SVG_PLAY;
    timerDigits.classList.remove("running");
    badge.textContent = "INATIVO";
    badge.className = "status-pill";
  }
}

function getFormConfig() {
  const intervalSec = Number(document.getElementById("intervalSec").value) || 25;
  const minSec = Number(document.getElementById("minSec").value) || null;
  const maxSec = Number(document.getElementById("maxSec").value) || null;
  const randomInterval = Boolean(minSec && maxSec && maxSec > minSec);

  return {
    intervalSec,
    minSec,
    maxSec,
    randomInterval,
    selector: document.getElementById("selector").value.trim(),
    keyword: document.getElementById("keyword").value.trim(),
    condition: document.getElementById("condition").value,
    soundType: document.getElementById("soundType")?.value || "chime",
    antiBlockJitter: document.getElementById("antiBlockJitter").checked,
    stealthMode: document.getElementById("stealthMode").checked,
    pauseOnCaptcha: document.getElementById("pauseOnCaptcha").checked
  };
}