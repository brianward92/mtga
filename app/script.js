(() => {
  const DATA_ROOT = "data";
  const DATA_SCHEMA_VERSION = 4;
  const STORAGE_PREFIX = "mtg_registry_v1";
  const PREFETCH_CONCURRENCY = 3;
  const DECODED_SET_CACHE_LIMIT = 4;
  const IMAGE_CACHE_LIMIT = 8;
  const NEARBY_IMAGE_LIMIT = 6;
  const BACKGROUND_PREFETCH_DELAY_MS = 6000;
  const NEARBY_PRELOAD_DELAY_MS = 1500;
  const NORMAL_IMAGE_UPGRADE_DELAY_MS = 3500;

  const imageCache = new Map();
  const failedImageUrls = new Set();

  const state = {
    sets: [],
    setMap: new Map(),
    decodedSets: new Map(),
    loadingSets: new Map(),
    currentSet: null,
    filteredCards: [],
    index: 0,
    loadToken: 0,
    imageLoadToken: 0,
    buildId: "",
    prefetchStarted: false,
    thumbnailCachePath: "",
    thumbnailSetCodes: new Set()
  };

  const setSelect = document.getElementById("setSelect");
  const colorFilter = document.getElementById("colorFilter");
  const nameSearch = document.getElementById("nameSearch");
  const resetFilters = document.getElementById("resetFilters");

  const prevCard = document.getElementById("prevCard");
  const nextCard = document.getElementById("nextCard");
  const position = document.getElementById("position");

  const cardName = document.getElementById("cardName");
  const metaName = document.getElementById("metaName");
  const metaNumber = document.getElementById("metaNumber");
  const metaColor = document.getElementById("metaColor");
  const metaMana = document.getElementById("metaMana");
  const metaType = document.getElementById("metaType");
  const metaSubtype = document.getElementById("metaSubtype");
  const valueHint = document.getElementById("valueHint");
  const priceUsd = document.getElementById("priceUsd");
  const priceFoil = document.getElementById("priceFoil");
  const priceEtched = document.getElementById("priceEtched");
  const setBadge = document.getElementById("setBadge");
  const rarityBadge = document.getElementById("rarityBadge");
  const cardImage = document.getElementById("cardImage");
  const noImage = document.getElementById("noImage");
  const flavorText = document.getElementById("flavorText");

  const currentCount = document.getElementById("currentCount");
  const setCountInput = document.getElementById("setCountInput");
  const setCountSave = document.getElementById("setCountSave");
  const deltaInput = document.getElementById("deltaInput");
  const addDelta = document.getElementById("addDelta");
  const subtractDelta = document.getElementById("subtractDelta");
  const zeroOut = document.getElementById("zeroOut");
  const clearRegistry = document.getElementById("clearRegistry");

  function init() {
    setSelect.disabled = true;
    setInventoryEnabled(false);
    bindEvents();
    loadStartupData();
  }

  function bindEvents() {
    setSelect.addEventListener("change", () => {
      onSetChange();
    });
    colorFilter.addEventListener("change", filterCards);
    nameSearch.addEventListener("input", filterCards);
    resetFilters.addEventListener("click", () => {
      colorFilter.value = "ALL";
      nameSearch.value = "";
      filterCards();
    });

    prevCard.addEventListener("click", () => moveIndex(-1));
    nextCard.addEventListener("click", () => moveIndex(1));

    setCountSave.addEventListener("click", saveExactCount);
    addDelta.addEventListener("click", () => adjustCount("add"));
    subtractDelta.addEventListener("click", () => adjustCount("subtract"));
    zeroOut.addEventListener("click", () => {
      setCountInput.value = "0";
      saveExactCount();
    });
    clearRegistry.addEventListener("click", clearCurrentSet);

    window.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft") {
        moveIndex(-1);
      } else if (e.key === "ArrowRight") {
        moveIndex(1);
      }
    });
  }

  function loadStartupData() {
    const bootstrap = window.MTG_REGISTRY_BOOTSTRAP;
    if (bootstrap && bootstrap.manifest && bootstrap.defaultSet) {
      try {
        const defaultSetCode = applyManifest(bootstrap.manifest);
        if (!defaultSetCode) return;

        const bootstrapSetCode = bootstrap.defaultSet.setCode || defaultSetCode;
        const setMeta = state.setMap.get(bootstrapSetCode) || state.setMap.get(defaultSetCode);
        if (!setMeta) {
          throw new Error(`Bootstrap set unavailable: ${bootstrapSetCode}`);
        }

        const loadedSet = decodeSetPayload(bootstrap.defaultSet, setMeta);
        state.loadToken += 1;
        state.currentSet = loadedSet;
        state.filteredCards = [];
        state.index = 0;
        setSelect.value = loadedSet.setCode;
        cacheDecodedSet(loadedSet);
        filterCards();
        scheduleBackgroundPrefetch(loadedSet.setCode);
        return;
      } catch (error) {
        console.error("Bootstrap data unavailable", error);
      }
    }

    loadManifest();
  }

  function applyManifest(manifest) {
    if (manifest.schemaVersion > DATA_SCHEMA_VERSION) {
      console.warn(`Manifest schema ${manifest.schemaVersion} is newer than client schema ${DATA_SCHEMA_VERSION}`);
    }
    state.buildId = manifest.buildId || "dev";
    state.thumbnailCachePath = normalizeThumbnailPath(manifest.thumbnailCachePath);
    state.thumbnailSetCodes = normalizeSetCodeSet(manifest.thumbnailSetCodes);
    state.sets = normalizeSets(manifest);
    state.setMap = new Map(state.sets.map((set) => [set.setCode, set]));

    if (!state.sets.length) {
      renderStatus("No sets available");
      return "";
    }

    populateSetSelect();
    const defaultSetCode =
      state.setMap.has(manifest.defaultSetCode)
        ? manifest.defaultSetCode
        : state.sets[state.sets.length - 1].setCode;
    setSelect.value = defaultSetCode;
    return defaultSetCode;
  }

  async function loadManifest() {
    renderStatus("Loading card database...");
    try {
      const manifest = await fetchJson(`${DATA_ROOT}/manifest.json`);
      const defaultSetCode = applyManifest(manifest);
      if (!defaultSetCode) return;
      await onSetChange();
      scheduleBackgroundPrefetch(defaultSetCode);
    } catch (error) {
      console.error(error);
      renderStatus("Card database unavailable");
    }
  }

  function normalizeSets(manifest) {
    if (!manifest || !Array.isArray(manifest.sets)) return [];
    return manifest.sets
      .filter((set) => set && set.setCode)
      .map((set) => ({
        setCode: set.setCode,
        setName: set.setName || set.setCode,
        cardCount: set.cardCount || 0,
        cardsPath: set.cardsPath || `sets/${set.setCode}.json`
      }));
  }

  function normalizeThumbnailPath(path) {
    return path ? String(path).replace(/^\/+|\/+$/g, "") : "";
  }

  function normalizeSetCodeSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter(Boolean).map((value) => String(value).toUpperCase()));
  }

  function populateSetSelect() {
    setSelect.innerHTML = "";
    state.sets.forEach((set) => {
      const option = document.createElement("option");
      option.value = set.setCode;
      option.textContent = `${set.setName} (${set.setCode})`;
      setSelect.appendChild(option);
    });
    setSelect.disabled = false;
  }

  async function onSetChange() {
    const setCode = setSelect.value;
    const setMeta = state.setMap.get(setCode);
    if (!setMeta) {
      state.currentSet = null;
      state.filteredCards = [];
      renderStatus("Set unavailable");
      return;
    }

    const token = ++state.loadToken;
    state.currentSet = { ...setMeta, cards: [] };
    state.filteredCards = [];
    state.index = 0;
    renderStatus(`Loading ${setMeta.setCode}...`);

    try {
      const loadedSet = await loadSet(setMeta);
      if (token !== state.loadToken) return;
      state.currentSet = loadedSet;
      filterCards();
    } catch (error) {
      if (token !== state.loadToken) return;
      console.error(error);
      state.currentSet = { ...setMeta, cards: [] };
      state.filteredCards = [];
      renderStatus(`Could not load ${setMeta.setCode}`);
    }
  }

  async function loadSet(setMeta) {
    const cachedSet = getDecodedSet(setMeta.setCode);
    if (cachedSet) {
      return cachedSet;
    }
    if (state.loadingSets.has(setMeta.setCode)) {
      return state.loadingSets.get(setMeta.setCode);
    }

    const loadPromise = fetchJson(setDataUrl(setMeta), "force-cache")
      .then((payload) => decodeSetPayload(payload, setMeta))
      .then((loadedSet) => {
        cacheDecodedSet(loadedSet);
        return loadedSet;
      })
      .finally(() => {
        state.loadingSets.delete(setMeta.setCode);
      });

    state.loadingSets.set(setMeta.setCode, loadPromise);
    return loadPromise;
  }

  function getDecodedSet(setCode) {
    if (!state.decodedSets.has(setCode)) return null;
    const loadedSet = state.decodedSets.get(setCode);
    state.decodedSets.delete(setCode);
    state.decodedSets.set(setCode, loadedSet);
    return loadedSet;
  }

  function cacheDecodedSet(loadedSet) {
    if (state.decodedSets.has(loadedSet.setCode)) {
      state.decodedSets.delete(loadedSet.setCode);
    }
    state.decodedSets.set(loadedSet.setCode, loadedSet);
    while (state.decodedSets.size > DECODED_SET_CACHE_LIMIT) {
      const oldestSetCode = state.decodedSets.keys().next().value;
      state.decodedSets.delete(oldestSetCode);
    }
  }

  function decodeSetPayload(payload, setMeta) {
    if (Array.isArray(payload)) {
      return {
        ...setMeta,
        cards: payload.map((card) => normalizeCard(card, setMeta.setCode))
      };
    }

    if (!payload || !Array.isArray(payload.cards)) {
      throw new Error(`Expected cards for ${setMeta.setCode}`);
    }

    const setCode = payload.setCode || setMeta.setCode;
    let cards;
    if (payload.cards.length && Array.isArray(payload.cards[0])) {
      if (!Array.isArray(payload.fields) || !payload.fields.length) {
        throw new Error(`Missing compact fields for ${setMeta.setCode}`);
      }
      cards = payload.cards.map((row) => normalizeCard(rowToCard(payload.fields, row), setCode));
    } else {
      cards = payload.cards.map((card) => normalizeCard(card, setCode));
    }

    return {
      ...setMeta,
      setCode,
      cards
    };
  }

  function rowToCard(fields, row) {
    const card = {};
    fields.forEach((field, index) => {
      card[field] = row[index];
    });
    return card;
  }

  function normalizeCard(card, setCode) {
    const imageNormalUrl =
      card.imageNormalUrl || card.image_normal_url || card.imageUrl || card.image_url || "";
    const imageSmallUrl =
      card.imageSmallUrl || card.image_small_url || imageNormalUrl;
    return {
      id: card.id || "",
      name: card.name || "",
      setCode: card.setCode || card.set_code || setCode,
      collectorNumber: card.collectorNumber || card.collector_number || "",
      colors: normalizeColors(card.colors),
      manaCost: card.manaCost || card.mana_cost || "",
      typeLine: card.typeLine || card.type_line || "",
      rarity: card.rarity || "",
      priceUsd: card.priceUsd ?? card.price_usd ?? card.price ?? null,
      priceUsdFoil: card.priceUsdFoil ?? card.price_usd_foil ?? null,
      priceUsdEtched: card.priceUsdEtched ?? card.price_usd_etched ?? null,
      valueHint: card.valueHint || card.value_hint || "",
      imageSmallUrl,
      imageNormalUrl,
      imageUrl: card.imageUrl || card.image_url || imageNormalUrl,
      flavorText: card.flavorText || card.flavor_text || ""
    };
  }

  function normalizeColors(colors) {
    if (Array.isArray(colors)) return colors.filter(Boolean);
    if (typeof colors === "string" && colors) return colors.split(",").filter(Boolean);
    return [];
  }

  function setDataUrl(setMeta) {
    const separator = setMeta.cardsPath.includes("?") ? "&" : "?";
    return `${DATA_ROOT}/${setMeta.cardsPath}${separator}v=${encodeURIComponent(state.buildId)}`;
  }

  function scheduleBackgroundPrefetch(currentSetCode) {
    if (state.prefetchStarted) return;
    state.prefetchStarted = true;
    const startPrefetch = () => {
      runIdle(() => {
        prefetchSets(currentSetCode);
      }, 2000);
    };
    window.setTimeout(startPrefetch, BACKGROUND_PREFETCH_DELAY_MS);
  }

  async function prefetchSets(currentSetCode) {
    const queue = [...state.sets]
      .reverse()
      .filter((set) => set.setCode !== currentSetCode);
    let nextIndex = 0;
    const workerCount = Math.min(PREFETCH_CONCURRENCY, queue.length);

    async function worker() {
      while (nextIndex < queue.length) {
        const setMeta = queue[nextIndex];
        nextIndex += 1;
        try {
          await prefetchSetFile(setMeta);
        } catch (error) {
          console.warn(`Could not prefetch ${setMeta.setCode}`, error);
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  async function prefetchSetFile(setMeta) {
    const url = setDataUrl(setMeta);
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    await response.arrayBuffer();
  }

  async function fetchJson(url, cacheMode = "no-store") {
    const response = await fetch(url, { cache: cacheMode });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return response.json();
  }

  function filterCards() {
    if (!state.currentSet || !state.currentSet.cards.length) {
      state.filteredCards = [];
      renderCard();
      return;
    }

    const color = colorFilter.value;
    const searchTerm = nameSearch.value.trim().toLowerCase();

    state.filteredCards = state.currentSet.cards.filter((card) => {
      const matchesColor = color === "ALL" ? true : cardColorFilter(card) === color;
      const matchesSearch = !searchTerm || card.name.toLowerCase().includes(searchTerm);
      return matchesColor && matchesSearch;
    }).sort((a, b) => compareCollector(a.collectorNumber, b.collectorNumber));

    if (state.index >= state.filteredCards.length) {
      state.index = 0;
    }

    renderCard();
  }

  function cardColorFilter(card) {
    if (!card.colors || card.colors.length === 0) return "C";
    if (card.colors.length > 1) return "MULTI";
    return card.colors[0];
  }

  function moveIndex(delta) {
    const nextIndex = state.index + delta;
    if (nextIndex < 0 || nextIndex >= state.filteredCards.length) return;
    state.index = nextIndex;
    renderCard();
  }

  function renderCard() {
    const card = state.filteredCards[state.index];
    if (!card) {
      renderStatus("No cards match this filter");
      return;
    }

    cardName.textContent = card.name;
    metaName.textContent = card.name;
    metaNumber.textContent = `#${card.collectorNumber}`;
    metaColor.textContent = displayColors(card);
    metaMana.textContent = card.manaCost || "-";
    const { mainType, subType } = splitTypeLine(card.typeLine);
    metaType.textContent = mainType || "-";
    metaSubtype.textContent = subType || "-";
    flavorText.textContent = card.flavorText ? `"${card.flavorText}"` : "-";
    valueHint.textContent = card.valueHint || "";
    priceUsd.textContent = formatPrice(card.priceUsd);
    priceFoil.textContent = formatPrice(card.priceUsdFoil);
    priceEtched.textContent = formatPrice(card.priceUsdEtched);
    setBadge.textContent = currentSetLabel();
    rarityBadge.textContent = card.rarity;
    rarityBadge.className = `chip ${rarityClass(card.rarity)}`;
    position.textContent = `${state.index + 1} / ${state.filteredCards.length}`;

    const inv = getInventoryForSet(state.currentSet.setCode);
    const count = inv[card.id] ?? 0;
    currentCount.textContent = count;
    setCountInput.value = count;
    setInventoryEnabled(true);

    prevCard.disabled = state.index === 0;
    nextCard.disabled = state.index >= state.filteredCards.length - 1;

    const imageToken = ++state.imageLoadToken;
    renderCardImage(card, imageToken);
    window.setTimeout(() => {
      if (imageToken === state.imageLoadToken) {
        runIdle(preloadNearbyImages, 1500);
      }
    }, NEARBY_PRELOAD_DELAY_MS);
  }

  function renderCardImage(card, imageToken) {
    const primaryUrl = preferredSmallImageUrl(card);
    const fallbackUrl = remoteSmallImageUrl(card);
    if (!primaryUrl) {
      hideCardImage();
      return;
    }

    const normalUrl = remoteNormalImageUrl(card);
    if (
      cardImage.currentCardId === card.id
      && (cardImage.currentImageUrl === primaryUrl || cardImage.currentImageUrl === normalUrl)
    ) {
      cardImage.style.display = "block";
      noImage.style.display = "none";
      scheduleCurrentImageUpgrade(card, imageToken, cardImage.currentImageUrl);
      return;
    }

    setCurrentImageSource(card, imageToken, primaryUrl, fallbackUrl);
    scheduleCurrentImageUpgrade(card, imageToken, primaryUrl);
  }

  function hideCardImage() {
    cardImage.onload = null;
    cardImage.onerror = null;
    cardImage.currentCardId = "";
    cardImage.currentImageUrl = "";
    cardImage.removeAttribute("src");
    cardImage.style.display = "none";
    noImage.style.display = "block";
  }

  function showCardImage(url, name, cardId = "") {
    cardImage.onload = null;
    cardImage.onerror = null;
    cardImage.currentCardId = cardId;
    cardImage.currentImageUrl = url;
    cardImage.alt = name ? `${name} card image` : "Card image";
    cardImage.src = url;
    cardImage.style.display = "block";
    noImage.style.display = "none";
  }

  function setCurrentImageSource(card, imageToken, url, fallbackUrl = "") {
    if (!url || failedImageUrls.has(url)) {
      if (fallbackUrl && fallbackUrl !== url) {
        setCurrentImageSource(card, imageToken, fallbackUrl);
      } else {
        hideCardImage();
      }
      return;
    }

    cardImage.alt = card.name ? `${card.name} card image` : "Card image";
    cardImage.fetchPriority = "high";
    cardImage.currentCardId = card.id;
    cardImage.onload = () => {
      if (!isCurrentCard(card, imageToken)) return;
      cardImage.style.display = "block";
      noImage.style.display = "none";
    };
    cardImage.onerror = () => {
      failedImageUrls.add(url);
      if (!isCurrentCard(card, imageToken)) return;
      if (fallbackUrl && fallbackUrl !== url) {
        setCurrentImageSource(card, imageToken, fallbackUrl);
      } else {
        hideCardImage();
      }
    };
    cardImage.style.display = "block";
    noImage.style.display = "none";
    if (cardImage.currentImageUrl !== url) {
      cardImage.currentImageUrl = url;
      cardImage.src = url;
    }
  }

  function loadCardSmallImage(card) {
    const primaryUrl = preferredSmallImageUrl(card);
    const fallbackUrl = remoteSmallImageUrl(card);
    if (!primaryUrl) {
      return Promise.reject(new Error("No image URL"));
    }
    return preloadImage(primaryUrl)
      .then(() => primaryUrl)
      .catch(() => {
        if (!fallbackUrl || fallbackUrl === primaryUrl) throw new Error("No fallback image URL");
        return preloadImage(fallbackUrl).then(() => fallbackUrl);
      });
  }

  function preferredSmallImageUrl(card) {
    if (shouldUseLocalThumbnail(card)) {
      return `${DATA_ROOT}/${state.thumbnailCachePath}/${encodeURIComponent(card.id)}.jpg`;
    }
    return remoteSmallImageUrl(card);
  }

  function shouldUseLocalThumbnail(card) {
    if (!state.thumbnailCachePath || !card.id) return false;
    if (!state.thumbnailSetCodes.size) return true;
    const setCode = String(card.setCode || state.currentSet?.setCode || "").toUpperCase();
    return state.thumbnailSetCodes.has(setCode);
  }

  function remoteSmallImageUrl(card) {
    return card.imageSmallUrl || card.imageUrl || card.imageNormalUrl || "";
  }

  function remoteNormalImageUrl(card) {
    return card.imageNormalUrl || card.imageUrl || card.imageSmallUrl || "";
  }

  function scheduleCurrentImageUpgrade(card, imageToken, displayedUrl) {
    const normalUrl = remoteNormalImageUrl(card);
    if (!normalUrl || normalUrl === displayedUrl) return;

    window.setTimeout(() => {
      runIdle(() => {
        if (!isCurrentCard(card, imageToken)) return;
        preloadImage(normalUrl)
          .then(() => {
            if (isCurrentCard(card, imageToken)) {
              showCardImage(normalUrl, card.name, card.id);
            }
          })
          .catch(() => {});
      }, 1500);
    }, NORMAL_IMAGE_UPGRADE_DELAY_MS);
  }

  function preloadNearbyImages() {
    if (!state.filteredCards.length) return;
    const offsets = [1, -1, 2, -2, 3, -3, 4, -4];
    let queued = 0;
    for (const offset of offsets) {
      if (queued >= NEARBY_IMAGE_LIMIT) break;
      const index = state.index + offset;
      if (index < 0 || index >= state.filteredCards.length) continue;
      const card = state.filteredCards[index];
      queued += 1;
      loadCardSmallImage(card).catch(() => {});
    }
  }

  function preloadImage(url) {
    if (!url || failedImageUrls.has(url)) {
      return Promise.reject(new Error("Image unavailable"));
    }

    if (imageCache.has(url)) {
      const entry = imageCache.get(url);
      imageCache.delete(url);
      imageCache.set(url, entry);
      return entry.promise;
    }

    const img = new Image();
    img.decoding = "async";
    const entry = {
      img,
      promise: new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => {
          failedImageUrls.add(url);
          imageCache.delete(url);
          reject(new Error(`Could not load image ${url}`));
        };
      })
    };

    imageCache.set(url, entry);
    trimImageCache();
    img.src = url;
    return entry.promise;
  }

  function trimImageCache() {
    while (imageCache.size > IMAGE_CACHE_LIMIT) {
      const oldestUrl = imageCache.keys().next().value;
      imageCache.delete(oldestUrl);
    }
  }

  function isCurrentCard(card, imageToken) {
    const currentCard = state.filteredCards[state.index];
    return imageToken === state.imageLoadToken && currentCard && currentCard.id === card.id;
  }

  function runIdle(callback, timeout) {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(callback, { timeout });
    } else {
      window.setTimeout(callback, Math.min(timeout, 300));
    }
  }

  function renderStatus(message) {
    state.imageLoadToken += 1;
    cardName.textContent = message;
    metaName.textContent = "";
    metaNumber.textContent = "";
    metaColor.textContent = "";
    metaMana.textContent = "";
    metaType.textContent = "";
    metaSubtype.textContent = "";
    flavorText.textContent = "-";
    valueHint.textContent = "";
    priceUsd.textContent = "-";
    priceFoil.textContent = "-";
    priceEtched.textContent = "-";
    setBadge.textContent = currentSetLabel();
    rarityBadge.textContent = "";
    rarityBadge.className = "chip";
    position.textContent = "0 / 0";
    currentCount.textContent = "0";
    setCountInput.value = "";
    hideCardImage();
    setInventoryEnabled(false);
    prevCard.disabled = true;
    nextCard.disabled = true;
  }

  function setInventoryEnabled(enabled) {
    setCountInput.disabled = !enabled;
    setCountSave.disabled = !enabled;
    deltaInput.disabled = !enabled;
    addDelta.disabled = !enabled;
    subtractDelta.disabled = !enabled;
    zeroOut.disabled = !enabled;
    clearRegistry.disabled = !enabled;
  }

  function currentSetLabel() {
    return state.currentSet
      ? `${state.currentSet.setName} (${state.currentSet.setCode})`
      : "";
  }

  function displayColors(card) {
    if (!card.colors || card.colors.length === 0) return "Colorless";
    if (card.colors.length > 1) return "Multicolor";
    const map = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
    return map[card.colors[0]] || card.colors.join(", ");
  }

  function compareCollector(a, b) {
    const pa = parseInt(a, 10);
    const pb = parseInt(b, 10);
    if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function formatPrice(val) {
    if (val === null || val === undefined || val === "") return "-";
    const num = typeof val === "number" ? val : parseFloat(val);
    if (Number.isNaN(num)) return val;
    return `$${num.toFixed(2)}`;
  }

  function splitTypeLine(line) {
    if (!line) return { mainType: "", subType: "" };
    const parts = line.split("—").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { mainType: parts[0], subType: parts.slice(1).join(" — ") };
    }
    return { mainType: line, subType: "" };
  }

  function rarityClass(rarity) {
    const key = (rarity || "").toLowerCase();
    if (key === "common") return "rarity-common";
    if (key === "uncommon") return "rarity-uncommon";
    if (key === "rare") return "rarity-rare";
    if (key === "mythic" || key === "mythic rare") return "rarity-mythic";
    return "";
  }

  function saveExactCount() {
    const card = state.filteredCards[state.index];
    if (!card) return;
    const parsed = parseInt(setCountInput.value, 10);
    if (Number.isNaN(parsed)) return;
    persistCount(card, parsed);
  }

  function adjustCount(mode) {
    const card = state.filteredCards[state.index];
    if (!card) return;
    const delta = parseInt(deltaInput.value, 10);
    if (Number.isNaN(delta)) return;
    const inv = getInventoryForSet(state.currentSet.setCode);
    const current = inv[card.id] ?? 0;
    const next = mode === "add" ? current + delta : current - delta;
    persistCount(card, next);
  }

  function persistCount(card, value) {
    const setCode = state.currentSet.setCode;
    const inv = getInventoryForSet(setCode);
    inv[card.id] = value;
    localStorage.setItem(storageKey(setCode), JSON.stringify(inv));
    renderCard();
  }

  function clearCurrentSet() {
    if (!state.currentSet) return;
    const setCode = state.currentSet.setCode;
    const confirmText = `Clear all saved counts for set ${setCode}? This cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    localStorage.removeItem(storageKey(setCode));
    renderCard();
  }

  function getInventoryForSet(setCode) {
    const raw = localStorage.getItem(storageKey(setCode));
    if (!raw) return {};
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }

  function storageKey(setCode) {
    return `${STORAGE_PREFIX}_${setCode}`;
  }

  init();
})();
