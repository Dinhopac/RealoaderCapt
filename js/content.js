(function () {
  document.getElementById("auto-btn")?.remove();
  document.getElementById("arp-floating-btn")?.remove();
  document.getElementById("arp-floating-menu")?.remove();
  document.getElementById("arp-picker-banner")?.remove();
  if (window._arpLiveWatcher) clearInterval(window._arpLiveWatcher);
  if (window._arpSoundLoop) clearInterval(window._arpSoundLoop);

  const DEFAULT_KEYWORDS = [
    "Online",
    "Disponível",
    "Liberado",
    "Erro",
    "Fora do ar",
    "Vermelho",
    "Verde",
    ".xls",
    ".pdf"
  ];

  let currentMonitor = null;
  let isPickingElement = false;
  let hoveredElement = null;
  let lastClickedMeta = null;
  let savedKeywords = [...DEFAULT_KEYWORDS];
  let showFloatingWidget = true;
  let pageDarkMode = false;
  let isPageReloading = false;
  let isAudioLooping = false;
  let soundSilencedByMouse = false;

  const btn = document.createElement("div");
  btn.id = "arp-floating-btn";
  btn.innerHTML = `<span class="arp-dot"></span> <span id="arp-timer">OFF</span>`;
  document.body.appendChild(btn);
  btn.addEventListener("click", () => toggleFloatingMenu());

  window._arpStartPicker = startElementPicker;

  window.addEventListener(
    "mousedown",
    () => {
      if (isAudioLooping) {
        soundSilencedByMouse = true;
        stopPersistentAlertSound();
      }
    },
    true
  );

  function getPageKey(urlStr) {
    try {
      const u = new URL(urlStr || location.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return (urlStr || location.href).split("#")[0];
    }
  }

  function isSamePage(urlA, urlB) {
    if (!urlA || !urlB) return false;
    const cleanA = urlA.split("#")[0];
    const cleanB = urlB.split("#")[0];
    return cleanA === cleanB || cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA);
  }

  function loadKeywordPresets(cb) {
    const pageKey = getPageKey(location.href);
    chrome.storage.local.get(
      ["keywordPresets", "showFloatingWidget", "darkModeByUrl", "monitors"],
      (data) => {
        if (Array.isArray(data.keywordPresets) && data.keywordPresets.length > 0) {
          savedKeywords = data.keywordPresets;
        } else {
          chrome.storage.local.set({ keywordPresets: DEFAULT_KEYWORDS });
        }

        showFloatingWidget = data.showFloatingWidget !== false;

        const darkMap = data.darkModeByUrl || {};
        const mon = (data.monitors || []).find((m) => isSamePage(location.href, m.url));
        pageDarkMode = Boolean(darkMap[pageKey] ?? mon?.darkMode);

        applyWidgetVisibility();
        applyPageDarkMode();
        if (cb) cb(savedKeywords);
      }
    );
  }

  function applyWidgetVisibility() {
    if (!btn) return;
    btn.style.setProperty("display", showFloatingWidget === false ? "none" : "flex", "important");
  }

  function applyPageDarkMode() {
    const hasClass = document.documentElement.classList.contains("arp-dark-page-mode");
    if (Boolean(pageDarkMode) !== hasClass) {
      document.documentElement.classList.toggle("arp-dark-page-mode", Boolean(pageDarkMode));
    }
  }

  function setTabDarkMode(enableDark, cb) {
    pageDarkMode = Boolean(enableDark);
    applyPageDarkMode();
    const pageKey = getPageKey(location.href);

    chrome.storage.local.get(["darkModeByUrl", "monitors"], (data) => {
      const darkMap = data.darkModeByUrl || {};
      darkMap[pageKey] = pageDarkMode;

      const monitors = data.monitors || [];
      const idx = monitors.findIndex((m) => isSamePage(location.href, m.url));
      if (idx > -1) {
        monitors[idx].darkMode = pageDarkMode;
      }

      chrome.storage.local.set({ darkModeByUrl: darkMap, monitors }, () => {
        if (cb) cb();
      });
    });
  }

  function isTransparent(c) {
    return !c || c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "rgb(0, 0, 0, 0)";
  }

  function classifyRgbColorName(rgbStr) {
    const m = (rgbStr || "").match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return rgbStr || "Padrão";
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (r > 180 && g < 100 && b < 100) return "Vermelho";
    if (g > 140 && r < 120 && b < 140) return "Verde";
    if (r > 190 && g > 130 && b < 90) return "Amarelo/Laranja";
    if (b > 170 && r < 110) return "Azul";
    if (r > 210 && g > 210 && b > 210) return "Branco";
    if (r < 45 && g < 45 && b < 55) return "Preto/Escuro";
    return "Cinza/Neutro";
  }

  function extractVisualColor(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return { raw: "rgb(0,0,0)", name: "N/A" };
    let cur = el;
    let bg = "";
    for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
      const st = window.getComputedStyle(cur);
      if (!isTransparent(st.backgroundColor)) {
        bg = st.backgroundColor;
        break;
      }
      cur = cur.parentElement;
    }
    const own = window.getComputedStyle(el);
    const fill = el.tagName === "svg" || el.tagName === "path" ? own.fill : "";
    const raw =
      bg ||
      (!isTransparent(fill) && fill.startsWith("rgb") ? fill : "") ||
      (!isTransparent(own.borderTopColor) ? own.borderTopColor : "") ||
      own.color ||
      "rgb(148,163,184)";
    return { raw, name: classifyRgbColorName(raw) };
  }

  function extractCardsSnapshot(containerEl) {
    if (!containerEl || containerEl.nodeType !== Node.ELEMENT_NODE) {
      return { count: 0, signature: "", cards: [] };
    }
    let nodes = Array.from(
      containerEl.querySelectorAll(
        ":scope > .card, :scope > [class*='card'], :scope > [class*='slide'], :scope > [class*='item'], :scope > ytd-rich-item-renderer, :scope > article, :scope > li"
      )
    );
    if (nodes.length === 0) {
      nodes = Array.from(containerEl.children).filter(
        (c) => !["SCRIPT", "STYLE", "BR"].includes(c.tagName)
      );
    }
    if (nodes.length === 0) nodes = [containerEl];

    const cards = nodes.map((node, idx) => {
      const text = (
        node.innerText ||
        node.textContent ||
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const col = extractVisualColor(node);
      return {
        index: idx + 1,
        text,
        color: col.raw,
        colorName: col.name,
        hash: `${text}|${col.raw}`
      };
    });
    return { count: cards.length, signature: cards.map((c) => c.hash).join("||"), cards };
  }

  function isExtensionElement(el) {
    return Boolean(
      el?.closest &&
        (el.closest("#arp-floating-btn") ||
          el.closest("#arp-floating-menu") ||
          el.closest("#arp-picker-banner"))
    );
  }

  function startElementPicker() {
    stopElementPicker();
    isPickingElement = true;
    document.getElementById("arp-floating-menu")?.remove();

    const banner = document.createElement("div");
    banner.id = "arp-picker-banner";
    banner.style.cssText =
      "position:fixed !important; top:14px !important; left:50% !important; transform:translateX(-50%) !important; background:#0f172a !important; color:#f8fafc !important; padding:10px 16px !important; border-radius:16px !important; border:2px solid #38bdf8 !important; box-shadow:0 12px 30px rgba(0,0,0,0.75) !important; z-index:2147483647 !important; font-family:'Segoe UI',system-ui,sans-serif !important; font-size:12.5px !important; display:flex !important; flex-direction:column !important; gap:7px !important; min-width:560px !important; max-width:94vw !important;";

    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; justify-content:space-between;">
        <span style="font-weight:700; white-space:nowrap;">🎯 Clique na frase/cor:</span>
        <code id="arp-picker-preview" style="flex:1; background:#1e293b !important; color:#38bdf8 !important; padding:4px 8px !important; border-radius:6px !important; font-size:11.5px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important;">Passe o mouse...</code>
        <input id="arp-picker-manual-input" type="text" placeholder="+ Palavra ou cor..." style="width:130px; background:#090d16; color:#fff; border:1px solid #475569; border-radius:6px; padding:4px 7px; font-size:11.5px; outline:none;" />
        <button id="arp-picker-plus-btn" type="button" title="Acrescentar à barra" style="background:linear-gradient(145deg,#475569,#334155) !important; color:#fff !important; border:1px solid #94a3b8 !important; padding:4px 10px !important; border-radius:6px !important; cursor:pointer !important; font-weight:700 !important; font-size:13px !important;">➕</button>
        <button id="arp-picker-cancel" type="button" title="Concluir e fechar barra" style="background:#ef4444 !important; color:#fff !important; border:none !important; padding:4px 10px !important; border-radius:6px !important; cursor:pointer !important; font-weight:700 !important;">✕</button>
      </div>
      <div id="arp-banner-sentence-words" style="display:none; flex-wrap:wrap; gap:4px; align-items:center; padding-top:4px; border-top:1px solid #1e293b;"></div>
      <div id="arp-banner-chips" style="display:flex; flex-wrap:wrap; gap:5px; align-items:center; min-height:22px; padding-top:4px; border-top:1px solid #1e293b;"></div>
    `;
    document.body.appendChild(banner);
    renderBannerAccumulatedChips();

    document.getElementById("arp-picker-plus-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const inputEl = document.getElementById("arp-picker-manual-input");
      const val = inputEl.value.trim();
      if (val) {
        accumulateTargetItem({
          id: Date.now().toString(),
          label: val,
          keyword: val,
          selector: lastClickedMeta?.cssSelector || "",
          capturedColor: lastClickedMeta?.capturedColor || "",
          capturedColorName: lastClickedMeta?.capturedColorName || "",
          condition: "color_or_word"
        });
        inputEl.value = "";
      }
    });

    document.getElementById("arp-picker-manual-input").addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("arp-picker-plus-btn").click();
      }
    });

    document.getElementById("arp-picker-cancel").addEventListener("click", (e) => {
      e.stopPropagation();
      stopElementPicker();
      toggleFloatingMenu(true);
    });

    window.addEventListener("mouseover", onPickerMouseOver, true);
    window.addEventListener("mouseout", onPickerMouseOut, true);
    window.addEventListener("pointerdown", onPickerBlockEvent, true);
    window.addEventListener("mousedown", onPickerBlockEvent, true);
    window.addEventListener("click", onPickerClick, true);
    window.addEventListener("keydown", onPickerKeyDown, true);
  }

  // Divide a frase clicada em palavras individuais na barra superior para o usuário escolher quais palavras vigiar!
  function renderBannerSentenceWords(sentence, meta) {
    const wordsRow = document.getElementById("arp-banner-sentence-words");
    if (!wordsRow) return;

    const words = (sentence || "")
      .split(/[\s,.;:!?()[\]"'«»“”/-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);

    if (words.length <= 1) {
      wordsRow.style.display = "none";
      return;
    }

    const uniqueWords = [...new Set(words)].slice(0, 18);
    wordsRow.style.display = "flex";
    wordsRow.innerHTML =
      `<span style="font-size:11px; color:#38bdf8; font-weight:700;">📝 Palavras da frase (clique p/ vigiar palavra + cor):</span>` +
      uniqueWords
        .map(
          (w) =>
            `<span data-word-token="${w}" style="background:#172033; color:#93c5fd; border:1px solid #3b82f6; border-radius:6px; padding:2px 7px; font-size:11px; cursor:pointer; font-weight:600;">+ ${w}</span>`
        )
        .join("");

    wordsRow.querySelectorAll("[data-word-token]").forEach((token) => {
      token.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const selectedWord = token.getAttribute("data-word-token");
        token.style.background = "#065f46";
        token.style.color = "#34d399";
        accumulateTargetItem({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
          label: selectedWord,
          keyword: selectedWord,
          selector: meta.cssSelector,
          xpath: meta.xpath,
          capturedColor: meta.capturedColor,
          capturedColorName: meta.capturedColorName,
          condition: "color_or_word"
        });
      });
    });
  }

  function renderBannerAccumulatedChips() {
    const tray = document.getElementById("arp-banner-chips");
    if (!tray) return;
    chrome.storage.local.get(["monitors"], (data) => {
      const monitors = data.monitors || [];
      const mon = monitors.find((m) => isSamePage(location.href, m.url));
      const targets = Array.isArray(mon?.targets) ? mon.targets : [];
      if (targets.length === 0) {
        tray.innerHTML = `<span style="font-size:11px; color:#94a3b8;">Clique em uma frase, palavra ou cor na página para acumular aqui...</span>`;
        return;
      }
      tray.innerHTML =
        `<span style="font-size:11px; color:#34d399; font-weight:700;">Acumulados (${targets.length}):</span>` +
        targets
          .map((t, idx) => {
            const dot = t.capturedColor
              ? `<i style="width:8px; height:8px; border-radius:50%; background:${t.capturedColor}; display:inline-block; border:1px solid #fff;"></i>`
              : `🎯`;
            return `<span style="display:inline-flex; align-items:center; gap:5px; background:#1e293b; color:#f8fafc; border:1px solid #475569; border-radius:999px; padding:2px 9px; font-size:11px;">${dot}<span>${(
              t.label ||
              t.keyword ||
              t.selector ||
              "Item"
            ).slice(0, 22)}</span><b data-rm-chip="${idx}" style="cursor:pointer; color:#f87171; font-size:13px;">×</b></span>`;
          })
          .join("");

      tray.querySelectorAll("[data-rm-chip]").forEach((rmBtn) => {
        rmBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const rmIdx = Number(rmBtn.getAttribute("data-rm-chip"));
          if (mon && Array.isArray(mon.targets)) {
            mon.targets.splice(rmIdx, 1);
            chrome.storage.local.set({ monitors }, () => renderBannerAccumulatedChips());
          }
        });
      });
    });
  }

  function stopElementPicker() {
    isPickingElement = false;
    if (hoveredElement) {
      hoveredElement.classList.remove("arp-hover-highlight");
      hoveredElement = null;
    }
    document.getElementById("arp-picker-banner")?.remove();
    window.removeEventListener("mouseover", onPickerMouseOver, true);
    window.removeEventListener("mouseout", onPickerMouseOut, true);
    window.removeEventListener("pointerdown", onPickerBlockEvent, true);
    window.removeEventListener("mousedown", onPickerBlockEvent, true);
    window.removeEventListener("click", onPickerClick, true);
    window.removeEventListener("keydown", onPickerKeyDown, true);
  }

  function onPickerBlockEvent(e) {
    if (!isPickingElement || isExtensionElement(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function extractElementMetadata(el) {
    const cardContainer = el.closest(
      "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer"
    );
    const anchorEl = el.tagName === "A" ? el : el.closest("a");
    const target = cardContainer || anchorEl || el;
    const tagName = target.tagName.toLowerCase();
    const href = anchorEl ? anchorEl.getAttribute("href") || anchorEl.href || "" : "";
    const cssSelector = generateCssSelector(target);
    const xpath = generateXPath(target);
    const rawText =
      el.innerText ||
      el.textContent ||
      target.innerText ||
      target.textContent ||
      el.getAttribute("title") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      target.querySelector("img")?.alt ||
      "";
    const fullSentence = rawText.replace(/\s+/g, " ").trim().split("\n")[0].slice(0, 120);
    const text = fullSentence.slice(0, 45);
    const fileMatch = href.match(/\.(xlsx?|csv|pdf|zip|docx?|xml)(\?.*)?$/i);
    const fileExt = fileMatch ? `.${fileMatch[1].toLowerCase()}` : "";
    const colorInfo = extractVisualColor(el);
    const cardsSnap = extractCardsSnapshot(target);

    return {
      tagName,
      href,
      cssSelector,
      xpath,
      text,
      fullSentence,
      fileExt,
      capturedColor: colorInfo.raw,
      capturedColorName: colorInfo.name,
      cardsCount: cardsSnap.count,
      cardsSignature: cardsSnap.signature,
      cardsList: cardsSnap.cards
    };
  }

  function onPickerMouseOver(e) {
    if (!isPickingElement) return;
    const target = e.target;
    if (
      isExtensionElement(target) ||
      target === document.body ||
      target === document.documentElement
    ) {
      return;
    }
    if (hoveredElement && hoveredElement !== target) {
      hoveredElement.classList.remove("arp-hover-highlight");
    }
    hoveredElement = target;
    hoveredElement.classList.add("arp-hover-highlight");
    const meta = extractElementMetadata(hoveredElement);
    const previewEl = document.getElementById("arp-picker-preview");
    if (previewEl) {
      const labelPreview = meta.text ? `"${meta.text.slice(0, 22)}" | ` : "";
      previewEl.textContent = `${labelPreview}<${meta.tagName}> Cor: ${meta.capturedColorName} | ${meta.cssSelector}`;
    }
  }

  function onPickerMouseOut(e) {
    if (isPickingElement && e.target?.classList) {
      e.target.classList.remove("arp-hover-highlight");
    }
  }

  function onPickerClick(e) {
    if (!isPickingElement || isExtensionElement(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const rawTarget = hoveredElement || e.target;
    rawTarget.classList.remove("arp-hover-highlight");
    rawTarget.style.outline = "2px dashed #10b981";
    rawTarget.setAttribute("data-arp-highlighted", "true");

    // Se o usuário selecionou/grifou uma palavra específica na página antes de clicar, usa a palavra grifada!
    const selectedText = (window.getSelection?.().toString() || "").trim();
    const meta = extractElementMetadata(rawTarget);
    lastClickedMeta = meta;

    // Exibe todas as palavras contidas na frase clicada para seleção individual!
    renderBannerSentenceWords(meta.fullSentence, meta);

    const chosenKeyword = selectedText || meta.fileExt || meta.text || meta.href || "";
    const itemLabel = chosenKeyword || `Cor:${meta.capturedColorName}` || meta.cssSelector;

    accumulateTargetItem({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
      label: itemLabel,
      keyword: chosenKeyword,
      fullSentence: meta.fullSentence,
      selector: meta.cssSelector,
      xpath: meta.xpath,
      href: meta.href,
      capturedTag: meta.tagName,
      capturedColor: meta.capturedColor,
      capturedColorName: meta.capturedColorName,
      cardsCount: meta.cardsCount,
      cardsSignature: meta.cardsSignature,
      cardsList: meta.cardsList,
      condition: "color_or_word"
    });
  }

  function onPickerKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      stopElementPicker();
      toggleFloatingMenu(true);
    }
  }

  function accumulateTargetItem(targetObj) {
    chrome.storage.local.get(["monitors", "keywordPresets", "capturedPresetsMap"], (data) => {
      const monitors = data.monitors || [];
      const presets = Array.isArray(data.keywordPresets)
        ? data.keywordPresets
        : [...DEFAULT_KEYWORDS];
      const presetsMap = data.capturedPresetsMap || {};

      if (targetObj.label) {
        const cleanIdx = presets.indexOf(targetObj.label);
        if (cleanIdx > -1) presets.splice(cleanIdx, 1);
        presets.unshift(targetObj.label);
        presetsMap[targetObj.label] = {
          selector: targetObj.selector,
          xpath: targetObj.xpath,
          keyword: targetObj.keyword || targetObj.label,
          capturedColor: targetObj.capturedColor,
          capturedColorName: targetObj.capturedColorName,
          condition: targetObj.condition || "color_or_word"
        };
        savedKeywords = presets;
      }

      const idx = monitors.findIndex((m) => isSamePage(location.href, m.url));
      let mon = idx > -1 ? monitors[idx] : null;
      if (!mon) {
        mon = {
          id: Date.now().toString(),
          name: document.title || location.hostname,
          url: location.href,
          intervalSec: 25,
          remainingSec: 25,
          nextReloadAt: Date.now() + 25000,
          antiBlockJitter: false,
          pauseOnCaptcha: true,
          stealthMode: false,
          darkMode: pageDarkMode,
          condition: "color_or_word",
          soundType: "chime",
          targets: [],
          status: "running",
          checks: 0
        };
        monitors.push(mon);
      }
      if (!Array.isArray(mon.targets)) mon.targets = [];
      if (!mon.targets.some((t) => t.selector === targetObj.selector && t.label === targetObj.label)) {
        mon.targets.push(targetObj);
      }

      Object.assign(mon, {
        selector: targetObj.selector || mon.selector,
        xpath: targetObj.xpath || mon.xpath,
        capturedHref: targetObj.href || mon.capturedHref,
        capturedTag: targetObj.capturedTag || mon.capturedTag,
        capturedColor: targetObj.capturedColor || mon.capturedColor,
        capturedColorName: targetObj.capturedColorName || mon.capturedColorName,
        cardsCount: targetObj.cardsCount ?? mon.cardsCount,
        cardsSignature: targetObj.cardsSignature || mon.cardsSignature,
        cardsList: targetObj.cardsList || mon.cardsList,
        lastCapturedSentence: targetObj.fullSentence || mon.lastCapturedSentence || "",
        keyword: targetObj.keyword || targetObj.label || mon.keyword,
        keywordMonitorPaused: false,
        stopOnTrigger: false,
        lastResult: `➕ ${mon.targets.length} alvo(s) | Cor: ${mon.capturedColorName || "N/A"}`
      });
      currentMonitor = mon;

      chrome.storage.local.set(
        { monitors, keywordPresets: presets, capturedPresetsMap: presetsMap },
        () => {
          renderBannerAccumulatedChips();
          syncUIWithStorage();
        }
      );
    });
  }

  function generateCssSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.id) {
      const idSel = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }
    if (el.tagName === "A") {
      const extMatch = (el.getAttribute("href") || "").match(/\.(xlsx?|csv|pdf|zip)(\?.*)?$/i);
      if (extMatch) return `a[href*=".${extMatch[1]}"]`;
    }
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        const idSel = `#${CSS.escape(current.id)}`;
        if (document.querySelectorAll(idSel).length === 1) {
          path.unshift(idSel);
          break;
        }
      }
      const validClasses = Array.from(current.classList)
        .filter((c) => c && !c.startsWith("arp-"))
        .slice(0, 2);
      if (validClasses.length > 0) {
        selector += "." + validClasses.map((c) => CSS.escape(c)).join(".");
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (ch) => ch.nodeName === current.nodeName
        );
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(selector);
      const candidate = path.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      current = parent;
    }
    return path.join(" > ");
  }

  function generateXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let idx = 1;
      let sib = current.previousElementSibling;
      while (sib) {
        if (sib.nodeName === current.nodeName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${current.nodeName.toLowerCase()}[${idx}]`);
      current = current.parentElement;
    }
    return "/" + parts.join("/");
  }

  function toggleFloatingMenu(forceOpen = false) {
    const existing = document.getElementById("arp-floating-menu");
    if (existing) {
      existing.remove();
      if (!forceOpen) return;
    }

    loadKeywordPresets(() => {
      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = data.monitors || [];
        const mon =
          monitors.find((m) => isSamePage(location.href, m.url)) || currentMonitor;

        const checksCount = mon?.checks || 0;
        const isRunning = mon?.status === "running";
        const isAlerting = Boolean(
          isRunning && mon?.alertTriggered && !mon?.keywordMonitorPaused
        );
        const targets = Array.isArray(mon?.targets) ? mon.targets : [];
        const selectorVal = mon?.selector || "Página inteira (body)";
        const condVal = mon?.condition || "color_or_word";
        const soundVal = mon?.soundType || "chime";
        const colorName = mon?.capturedColorName || "N/A";
        const colorRaw = mon?.capturedColor || "#64748b";
        const cardsCount = mon?.cardsCount ?? 0;
        const lastResultVal = mon?.lastResult || "Clique em ➕ para acumular alvos...";

        let statusText = "⏸ Inativo";
        if (isRunning) statusText = "🟢 Ativo (Reload)";
        if (isAlerting) statusText = "🚨 Alerta Efetivo!";

        const chipsHtml =
          targets.length > 0
            ? targets
                .map((t) => {
                  const dot = t.capturedColor
                    ? `<i style="width:7px;height:7px;border-radius:50%;background:${t.capturedColor};display:inline-block;border:1px solid #fff;margin-right:4px;"></i>`
                    : `🎯 `;
                  return `<span style="display:inline-block; background:#181c24; border:1px solid #475569; border-radius:999px; padding:2px 7px; font-size:10.5px; margin:2px;">${dot}${(
                    t.label ||
                    t.keyword ||
                    t.selector
                  ).slice(0, 22)}</span>`;
                })
                .join("")
            : `<span style="color:#64748b; font-size:11px;">Nenhum item acumulado</span>`;

        const menu = document.createElement("div");
        menu.id = "arp-floating-menu";
        menu.innerHTML = `
          <div class="arp-menu-header">
            <span class="arp-menu-title">🛡️ ReloaderCapt Pro</span>
            <div class="arp-header-right">
              <span id="arp-live-checks-badge" class="arp-badge-count">${checksCount} ciclos</span>
              <button id="arp-demo-plus-pick" type="button" title="Abrir barra de captura na página (➕)" style="background:#334155 !important; color:#fff !important; border:1px solid #64748b !important; width:24px !important; height:24px !important; border-radius:6px !important; cursor:pointer !important; font-size:12px !important; padding:0 !important; margin:0 !important;">➕</button>
              <button id="arp-dark-page-btn" type="button" title="Fixar Modo Dark / Cinza nesta aba" style="background:${pageDarkMode ? "rgba(250,204,21,0.22)" : "#27303f"} !important; color:#fde047 !important; border:1px solid ${pageDarkMode ? "#eab308" : "#334155"} !important; width:24px !important; height:24px !important; border-radius:6px !important; cursor:pointer !important; font-size:12px !important; padding:0 !important; margin:0 !important;">🌙</button>
              <button id="arp-hide-widget-btn" type="button" title="Ocultar indicador do canto" style="background:#27303f !important; color:#94a3b8 !important; border:1px solid #334155 !important; width:24px !important; height:24px !important; border-radius:6px !important; cursor:pointer !important; font-size:12px !important; padding:0 !important; margin:0 !important;">👁️</button>
              <button id="arp-close-menu" type="button" title="Fechar janela">✕</button>
            </div>
          </div>

          <div class="arp-demo-grid">
            <div class="arp-demo-item">
              <span class="arp-demo-label">Status Efetivo</span>
              <div id="arp-live-status-text" class="arp-demo-value ${isAlerting ? "alert-text" : isRunning ? "highlight" : ""}">${statusText}</div>
            </div>
            <div class="arp-demo-item">
              <span class="arp-demo-label">Cor Base &amp; Cards</span>
              <div class="arp-demo-value" style="display:flex; align-items:center; gap:5px;">
                <span style="width:10px; height:10px; border-radius:50%; background:${colorRaw}; display:inline-block; border:1px solid #fff;"></span>
                <span>${colorName} (${cardsCount})</span>
              </div>
            </div>
          </div>

          <div class="arp-demo-item">
            <span class="arp-demo-label">Alvos e Cores Acumulados (${targets.length})</span>
            <div class="arp-demo-value" style="max-height:60px; overflow-y:auto;">${chipsHtml}</div>
          </div>

          <div class="arp-demo-item">
            <span class="arp-demo-label">Seletor CSS Capturado</span>
            <div class="arp-demo-value" style="font-family:Consolas,monospace; font-size:11px; color:#60a5fa; word-break:break-all;">${selectorVal}</div>
          </div>

          <div class="arp-demo-item">
            <span class="arp-demo-label">Modo Principal de Detecção</span>
            <select id="arp-demo-cond-select">
              <option value="color_or_word" ${condVal === "color_or_word" ? "selected" : ""}>🎨+🔍 Cor Mudar OU Palavra Aparecer</option>
              <option value="color_and_word" ${condVal === "color_and_word" ? "selected" : ""}>🎨+🔍 Cor Mudar E Palavra Aparecer</option>
              <option value="found" ${condVal === "found" ? "selected" : ""}>🔍 Palavra / Link Aparecer</option>
              <option value="color_change" ${condVal === "color_change" ? "selected" : ""}>🎨 Apenas Mudar de Cor</option>
              <option value="lost" ${condVal === "lost" ? "selected" : ""}>🚫 Palavra / Link Sumir</option>
              <option value="cards_change" ${condVal === "cards_change" ? "selected" : ""}>🗂️ Quadro / Slide Alterar Cards</option>
            </select>
          </div>

          <div class="arp-demo-item">
            <span class="arp-demo-label">🔊 Áudio Contínuo (Para ao clicar na tela)</span>
            <div style="display:flex; gap:5px; margin-top:2px; align-items:center;">
              <select id="arp-demo-sound-select" style="flex:1; color:#fde047 !important;">
                <option value="chime" ${soundVal === "chime" ? "selected" : ""}>🔔 Sino Cristalino (Padrão)</option>
                <option value="siren" ${soundVal === "siren" ? "selected" : ""}>🚨 Sirene de Emergência</option>
                <option value="radar" ${soundVal === "radar" ? "selected" : ""}>📡 Sonar / Radar Militar</option>
                <option value="arcade" ${soundVal === "arcade" ? "selected" : ""}>👾 8-Bit Arcade (Retrô)</option>
                <option value="urgent" ${soundVal === "urgent" ? "selected" : ""}>⚠️ Bip Triplo Urgente</option>
                <option value="mute" ${soundVal === "mute" ? "selected" : ""}>🔇 Silencioso (Sem Som)</option>
              </select>
              <button id="arp-test-sound-btn" type="button" title="Testar este áudio agora" style="background:#27303f !important; color:#fde047 !important; border:1px solid #475569 !important; width:28px !important; height:28px !important; border-radius:6px !important; cursor:pointer !important; font-size:13px !important; padding:0 !important; margin:0 !important; flex-shrink:0 !important;">🔊</button>
            </div>
          </div>

          <div class="arp-demo-item">
            <span class="arp-demo-label">Demonstração da Última Leitura</span>
            <div id="arp-live-last-result" class="arp-demo-value ${isAlerting ? "alert-text" : ""}">${lastResultVal}</div>
          </div>
        `;
        document.body.appendChild(menu);

        document.getElementById("arp-close-menu").addEventListener("click", (e) => {
          e.stopPropagation();
          menu.remove();
        });

        document.getElementById("arp-demo-plus-pick").addEventListener("click", (e) => {
          e.stopPropagation();
          startElementPicker();
        });

        document.getElementById("arp-dark-page-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          setTabDarkMode(!pageDarkMode, () => toggleFloatingMenu(true));
        });

        document.getElementById("arp-hide-widget-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          showFloatingWidget = false;
          chrome.storage.local.set({ showFloatingWidget: false });
          applyWidgetVisibility();
          menu.remove();
        });

        document.getElementById("arp-demo-cond-select").addEventListener("change", (e) => {
          if (mon) updateMonitorStatus(mon.id, { condition: e.target.value });
        });

        const soundSelect = document.getElementById("arp-demo-sound-select");
        soundSelect.addEventListener("change", (e) => {
          const chosen = e.target.value;
          stopPersistentAlertSound();
          playAlertSoundOnce(chosen);
          if (mon) updateMonitorStatus(mon.id, { soundType: chosen });
        });

        document.getElementById("arp-test-sound-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          stopPersistentAlertSound();
          playAlertSoundOnce(soundSelect.value);
        });
      });
    });
  }

  function clearPageHighlights() {
    document.querySelectorAll("[data-arp-highlighted='true']").forEach((el) => {
      el.style.outline = "";
      el.style.backgroundColor = "";
      el.removeAttribute("data-arp-highlighted");
    });
  }

  function resolveTargetElement(docRoot, selectorOrXpath) {
    if (!selectorOrXpath) return docRoot.body;
    const trimmed = selectorOrXpath.trim();
    if (trimmed.startsWith("/")) {
      try {
        return docRoot.evaluate(
          trimmed,
          docRoot,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
      } catch {
        return null;
      }
    }
    try {
      return docRoot.querySelector(trimmed);
    } catch {
      return null;
    }
  }

  // Motor de inspeção que detecta simultaneamente Mudança de Cor E/OU Aparição de Palavra da Frase
  function inspectSingleRule(docRoot, rule, globalCondition) {
    const cond = rule.condition || globalCondition || "color_or_word";
    const targetEl = resolveTargetElement(docRoot, rule.selector);
    if (!targetEl) {
      if (cond === "lost") {
        return { triggered: true, el: null, msg: `Alvo "${rule.label || rule.selector}" sumiu!` };
      }
      return { triggered: false };
    }

    const rawKeyword = (rule.keyword || "").trim();
    const liveColor = extractVisualColor(targetEl);
    const baseColor = rule.capturedColor || "";
    const baseName = rule.capturedColorName || "Original";
    const hasColorChanged = Boolean(baseColor && liveColor.raw !== baseColor);

    if (cond === "color_change") {
      if (hasColorChanged) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🎨 Cor mudou: ${baseName} → ${liveColor.name} (${liveColor.raw})`
        };
      }
      return { triggered: false };
    }

    if (cond === "cards_change") {
      const currentSnap = extractCardsSnapshot(targetEl);
      if (rule.cardsSignature && currentSnap.signature !== rule.cardsSignature) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🗂️ Parte/Card alterado em "${rule.label || rule.selector}"!`
        };
      }
      return { triggered: false };
    }

    const words =
      rawKeyword === "@TODAS"
        ? savedKeywords
        : rawKeyword
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean);

    const textContent = (targetEl.innerText || targetEl.textContent || "").toLowerCase();
    const htmlContent = (targetEl.outerHTML || "").toLowerCase();
    const links = [];
    if (targetEl.tagName === "A") {
      links.push(targetEl.getAttribute("href") || "", targetEl.href || "");
    }
    targetEl
      .querySelectorAll?.("a[href]")
      .forEach((a) =>
        links.push(a.getAttribute("href") || "", a.href || "", a.getAttribute("download") || "")
      );
    const allLinks = links.join(" ").toLowerCase();

    const matchedWord = words.find((w) => {
      const lw = w.toLowerCase();
      return (
        textContent.includes(lw) ||
        allLinks.includes(lw) ||
        htmlContent.includes(lw) ||
        liveColor.name.toLowerCase() === lw
      );
    });

    const wordFound = Boolean(matchedWord);

    // MODO COMBINADO 1: Alerta se a Cor Mudar OU a Palavra Aparecer
    if (cond === "color_or_word") {
      if (hasColorChanged && wordFound) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🎨+🔍 Cor mudou (${baseName}→${liveColor.name}) e palavra "${matchedWord}" detectada!`
        };
      }
      if (hasColorChanged) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🎨 Cor alterada de ${baseName} para ${liveColor.name}!`
        };
      }
      if (wordFound) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🔍 Palavra "${matchedWord}" detectada (Cor: ${liveColor.name})!`
        };
      }
      return { triggered: false };
    }

    // MODO COMBINADO 2: Alerta somente se a Cor Mudar E a Palavra Aparecer
    if (cond === "color_and_word") {
      if (hasColorChanged && wordFound) {
        return {
          triggered: true,
          el: targetEl,
          msg: `🎨+🔍 Cor mudou (${baseName}→${liveColor.name}) E palavra "${matchedWord}" presente!`
        };
      }
      return { triggered: false };
    }

    if (!rawKeyword && rule.selector) {
      return {
        triggered: cond === "found",
        el: targetEl,
        msg: `Elemento "${rule.label || rule.selector}" presente!`
      };
    }

    if ((cond === "found" && wordFound) || (cond === "lost" && !wordFound)) {
      return {
        triggered: true,
        el: targetEl,
        msg: `Detectado "${matchedWord || rawKeyword}" (Cor: ${liveColor.name}) às ${new Date().toLocaleTimeString()}`
      };
    }
    return { triggered: false };
  }

  function inspectDocument(docRoot, monitor) {
    if (!monitor || monitor.status !== "running" || monitor.keywordMonitorPaused) {
      stopPersistentAlertSound();
      return false;
    }

    const rulesToCheck =
      Array.isArray(monitor.targets) && monitor.targets.length > 0 ? monitor.targets : [monitor];
    for (const rule of rulesToCheck) {
      const res = inspectSingleRule(docRoot, rule, monitor.condition);
      if (res.triggered) {
        triggerContinuousAlert(monitor, res.el, res.msg);
        return true;
      }
    }

    stopPersistentAlertSound();
    updateMonitorStatus(monitor.id, {
      alertTriggered: false,
      lastResult: `Verificado (${rulesToCheck.length} alvo[s]) às ${new Date().toLocaleTimeString()}`
    });
    return false;
  }

  function triggerContinuousAlert(monitor, targetEl, detailMessage) {
    if (monitor.status !== "running") return;
    soundSilencedByMouse = false;
    startPersistentAlertSound(monitor.soundType || "chime");

    btn.classList.remove("arp-active");
    btn.classList.add("arp-triggered");
    if (targetEl && targetEl !== document.body) {
      targetEl.style.outline = "3px solid #eab308";
      targetEl.setAttribute("data-arp-highlighted", "true");
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    updateMonitorStatus(monitor.id, {
      alertTriggered: true,
      stopOnTrigger: false,
      lastResult: detailMessage
    });
    chrome.runtime.sendMessage({
      action: "keyword-triggered",
      monitor,
      detail: detailMessage
    });
  }

  function startPersistentAlertSound(soundType = "chime") {
    if (soundType === "mute" || soundSilencedByMouse) return;

    if (!isAudioLooping) {
      isAudioLooping = true;
      playAlertSoundOnce(soundType);
      if (window._arpSoundLoop) clearInterval(window._arpSoundLoop);
      window._arpSoundLoop = setInterval(() => {
        if (
          soundSilencedByMouse ||
          !currentMonitor ||
          currentMonitor.status !== "running" ||
          !currentMonitor.alertTriggered
        ) {
          stopPersistentAlertSound();
          return;
        }
        playAlertSoundOnce(currentMonitor.soundType || soundType);
      }, 1450);
    }
  }

  function stopPersistentAlertSound() {
    isAudioLooping = false;
    if (window._arpSoundLoop) {
      clearInterval(window._arpSoundLoop);
      window._arpSoundLoop = null;
    }
  }

  function playAlertSoundOnce(soundType = "chime") {
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
      // Áudio bloqueado até primeira interação na página
    }
  }

  async function performStealthDomCheck(monitor) {
    if (monitor.status !== "running") return;
    try {
      const response = await fetch(location.href, {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      });
      const html = await response.text();
      const freshDoc = new DOMParser().parseFromString(html, "text/html");
      inspectDocument(freshDoc, monitor);
    } catch {
      window.location.reload();
    }
  }

  window._arpLiveWatcher = setInterval(() => {
    applyPageDarkMode();

    if (!currentMonitor || currentMonitor.status !== "running") return;

    if (
      currentMonitor.nextReloadAt &&
      Date.now() >= currentMonitor.nextReloadAt &&
      !isPageReloading
    ) {
      isPageReloading = true;
      const nextSec = Number(currentMonitor.intervalSec) || 25;
      const newNextAt = Date.now() + nextSec * 1000;
      currentMonitor.nextReloadAt = newNextAt;

      chrome.storage.local.get(["monitors"], (data) => {
        const monitors = data.monitors || [];
        const item = monitors.find(
          (m) => m.id === currentMonitor.id || isSamePage(location.href, m.url)
        );
        if (item) {
          item.checks = (item.checks || 0) + 1;
          item.nextReloadAt = newNextAt;
          item.remainingSec = nextSec;
          item.lastChecked = new Date().toLocaleTimeString();
        }
        chrome.storage.local.set({ monitors }, () => {
          if (currentMonitor.stealthMode === true) {
            performStealthDomCheck(currentMonitor);
            setTimeout(() => {
              isPageReloading = false;
            }, 800);
          } else {
            window.location.reload();
          }
        });
      });
      return;
    }

    syncUIWithStorage();
  }, 500);

  function syncUIWithStorage() {
    const pageKey = getPageKey(location.href);
    chrome.storage.local.get(["monitors", "showFloatingWidget", "darkModeByUrl"], (data) => {
      showFloatingWidget = data.showFloatingWidget !== false;
      const darkMap = data.darkModeByUrl || {};
      const monitors = data.monitors || [];
      const found = monitors.find((m) => isSamePage(location.href, m.url));

      pageDarkMode = Boolean(darkMap[pageKey] ?? found?.darkMode);
      applyWidgetVisibility();
      applyPageDarkMode();

      const timerSpan = document.getElementById("arp-timer");
      if (!found) {
        stopPersistentAlertSound();
        btn.classList.remove("arp-active", "arp-triggered");
        if (timerSpan) timerSpan.textContent = "OFF";
        return;
      }

      currentMonitor = found;
      const rem = found.nextReloadAt
        ? Math.max(0, Math.ceil((found.nextReloadAt - Date.now()) / 1000))
        : found.remainingSec ?? found.intervalSec ?? 25;
      const checks = found.checks || 0;
      const isAlerting = Boolean(found.alertTriggered && !found.keywordMonitorPaused);

      if (found.status === "running") {
        if (isAlerting) {
          btn.classList.remove("arp-active");
          btn.classList.add("arp-triggered");
          if (timerSpan) timerSpan.textContent = `🚨 ALERTA! • ${rem}s (#${checks})`;
          startPersistentAlertSound(found.soundType || "chime");
        } else {
          stopPersistentAlertSound();
          btn.classList.remove("arp-triggered");
          btn.classList.add("arp-active");
          if (timerSpan) {
            timerSpan.textContent = `${found.stealthMode ? "🕵️ " : ""}${rem}s (#${checks})`;
          }
        }
      } else {
        stopPersistentAlertSound();
        btn.classList.remove("arp-active", "arp-triggered");
        if (timerSpan) timerSpan.textContent = "OFF";
      }

      const badgeEl = document.getElementById("arp-live-checks-badge");
      if (badgeEl) badgeEl.textContent = `${checks} ciclos`;

      const statusEl = document.getElementById("arp-live-status-text");
      if (statusEl) {
        let stText = "⏸ Inativo";
        if (found.status === "running") stText = "🟢 Ativo (Reload)";
        if (isAlerting) stText = "🚨 Alerta Efetivo!";
        statusEl.textContent = stText;
      }

      const lastResEl = document.getElementById("arp-live-last-result");
      if (lastResEl && found.lastResult) {
        lastResEl.textContent = found.lastResult;
      }
    });
  }

  function updateMonitorStatus(id, patch) {
    chrome.storage.local.get(["monitors"], (data) => {
      const monitors = data.monitors || [];
      const item = monitors.find((m) => m.id === id);
      if (item) {
        Object.assign(item, patch);
        chrome.storage.local.set({ monitors });
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.monitors || changes.showFloatingWidget || changes.darkModeByUrl)
    ) {
      syncUIWithStorage();
    }
    if (area === "local" && changes.keywordPresets) {
      savedKeywords = changes.keywordPresets.newValue || DEFAULT_KEYWORDS;
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ alive: true });
      return;
    }
    if (msg.action === "force-page-reload") {
      window.location.reload();
      return;
    }
    if (msg.action === "set-tab-dark-mode") {
      setTabDarkMode(msg.enableDark, () => sendResponse({ ok: true }));
      return true;
    }
    if (msg.action === "sync-ui") {
      syncUIWithStorage();
      return;
    }
    if (msg.action === "start-element-picker") {
      startElementPicker();
      return;
    }
    if (msg.action === "run-stealth-check") {
      performStealthDomCheck(msg.monitor);
      return;
    }
    if (msg.action === "inspect-now") {
      inspectDocument(document, msg.monitor);
      return;
    }
    if (msg.action === "clear-highlights") {
      stopPersistentAlertSound();
      clearPageHighlights();
    }
  });

  loadKeywordPresets(() => {
    chrome.storage.local.get(["monitors"], (data) => {
      const found = (data.monitors || []).find((m) => isSamePage(location.href, m.url));
      if (found?.status === "running") {
        inspectDocument(document, found);
      }
      syncUIWithStorage();
    });
  });
})();