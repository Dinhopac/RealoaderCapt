let masterTicker = null;
let isTickRunning = false;

function setupKeepAliveAlarm() {
  if (chrome.alarms) {
    try {
      chrome.alarms.create("arp-keepalive", { periodInMinutes: 0.4 });
    } catch (e) {}
  }
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "arp-keepalive") {
      startMasterLoop();
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["monitors"], (res) => {
    if (!res.monitors) chrome.storage.local.set({ monitors: [] });
  });
  setupKeepAliveAlarm();
  startMasterLoop();
});

chrome.runtime.onStartup.addListener(() => {
  setupKeepAliveAlarm();
  startMasterLoop();
});

function isSamePage(urlA, urlB) {
  if (!urlA || !urlB) return false;
  const cleanA = urlA.split("#")[0];
  const cleanB = urlB.split("#")[0];
  return cleanA === cleanB || cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA);
}

// Mostra o selo "ON" ou "!1" APENAS na aba onde o monitoramento está ativo (abas OFF ficam limpas!)
async function updateExtensionToolbarBadge(monitors) {
  if (!chrome.action?.setBadgeText) return;

  // Limpa o selo global padrão para não vazar para abas que estão OFF
  chrome.action.setBadgeText({ text: "" });

  const tabs = await chrome.tabs.query({});
  const list = monitors || [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const mon = list.find((m) => m.tabId === tab.id || isSamePage(tab.url, m.url));

    if (mon && mon.status === "running") {
      if (mon.alertTriggered && !mon.keywordMonitorPaused) {
        chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#ef4444" });
      } else {
        chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#10b981" });
      }
    } else {
      chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    }
  }
}

async function ensureContentScriptInjected(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (err) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["css/button.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["js/content.js"] });
      return true;
    } catch (injectErr) {
      return false;
    }
  }
}

function computeNextInterval(monitor) {
  if (monitor.randomInterval && monitor.minSec && monitor.maxSec) {
    const min = Math.ceil(Number(monitor.minSec));
    const max = Math.floor(Number(monitor.maxSec));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  const base = Number(monitor.intervalSec) || 25;
  if (monitor.antiBlockJitter === true) {
    const variation = Math.max(1, Math.round(base * 0.25));
    const min = Math.max(2, base - variation);
    const max = base + variation;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return base;
}

// Executa o reload real da aba usando múltiplos métodos para nunca falhar
async function reloadMonitorTabNow(monitor) {
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find((t) => t.id === monitor.tabId && t.url && t.url.startsWith("http"));
  if (!targetTab) {
    targetTab = tabs.find((t) => t.url && isSamePage(t.url, monitor.url));
  }
  if (!targetTab) {
    try {
      const host = new URL(monitor.url).hostname;
      targetTab = tabs.find((t) => t.url && t.url.includes(host));
    } catch (e) {}
  }
  if (!targetTab) return;

  if (monitor.stealthMode) {
    const ok = await ensureContentScriptInjected(targetTab.id);
    if (ok) {
      chrome.tabs.sendMessage(targetTab.id, { action: "run-stealth-check", monitor }).catch(() => {});
    }
  } else {
    try {
      await chrome.tabs.reload(targetTab.id, { bypassCache: false });
    } catch (err) {
      chrome.scripting
        .executeScript({
          target: { tabId: targetTab.id },
          func: () => window.location.reload()
        })
        .catch(() => {});
    }
  }
}

function startMasterLoop() {
  if (masterTicker) clearInterval(masterTicker);

  masterTicker = setInterval(() => {
    if (isTickRunning) return;
    isTickRunning = true;

    chrome.storage.local.get(["monitors"], async (data) => {
      try {
        const monitors = data.monitors || [];
        updateExtensionToolbarBadge(monitors);

        let changed = false;
        const toReload = [];
        const now = Date.now();

        for (const m of monitors) {
          if (m.status !== "running") continue;

          if (!m.nextReloadAt) {
            const sec = computeNextInterval(m);
            m.nextReloadAt = now + sec * 1000;
            m.remainingSec = sec;
            changed = true;
          } else {
            const rem = Math.max(0, Math.ceil((m.nextReloadAt - now) / 1000));
            if (m.remainingSec !== rem) {
              m.remainingSec = rem;
              changed = true;
            }
          }

          // Quando o tempo zera, reinicia o relógio imediatamente e agenda o reload da aba!
          if (now >= m.nextReloadAt) {
            const nextSec = computeNextInterval(m);
            m.checks = (m.checks || 0) + 1;
            m.lastChecked = new Date().toLocaleTimeString();
            m.nextReloadAt = now + nextSec * 1000;
            m.remainingSec = nextSec;
            changed = true;
            toReload.push({ ...m });
          }
        }

        if (changed) {
          await chrome.storage.local.set({ monitors });
        }

        for (const m of toReload) {
          await reloadMonitorTabNow(m);
        }
      } finally {
        isTickRunning = false;
      }
    });
  }, 500);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("http")) {
    chrome.storage.local.get(["monitors"], async (data) => {
      const monitors = data.monitors || [];
      const found = monitors.find((m) => m.tabId === tabId || isSamePage(tab.url, m.url));
      if (found) {
        await ensureContentScriptInjected(tabId);
        if (found.status === "running") {
          chrome.tabs.sendMessage(tabId, { action: "inspect-now", monitor: found }).catch(() => {});
        } else {
          chrome.tabs.sendMessage(tabId, { action: "sync-ui" }).catch(() => {});
        }
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  startMasterLoop();

  if (msg.action === "sync-monitor-state") {
    const tabId = msg.tabId || sender.tab?.id;
    chrome.storage.local.get(["monitors"], (data) => {
      updateExtensionToolbarBadge(data.monitors || []);
    });
    if (tabId) {
      ensureContentScriptInjected(tabId).then(() => {
        chrome.tabs.sendMessage(tabId, { action: "sync-ui" }).catch(() => {});
        if (msg.clearHighlights) {
          chrome.tabs.sendMessage(tabId, { action: "clear-highlights" }).catch(() => {});
        }
        if (msg.runImmediateInspect && msg.monitor) {
          chrome.tabs.sendMessage(tabId, { action: "inspect-now", monitor: msg.monitor }).catch(() => {});
        }
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "reload-tab") {
    const tabId = msg.tabId || sender.tab?.id;
    if (tabId) {
      chrome.tabs.reload(tabId, { bypassCache: false }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "keyword-triggered") {
    const { monitor, detail } = msg;
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: `🚨 Alerta Detectado!`,
      message: detail || `Alteração detectada em: ${monitor.name || monitor.url}`,
      priority: 2
    });
  }

  if (msg.action === "open-monitor-tab") {
    chrome.tabs.create({ url: msg.url, active: false }, (tab) => {
      sendResponse({ tabId: tab.id });
    });
    return true;
  }
});

startMasterLoop();