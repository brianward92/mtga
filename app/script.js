(() => {
  const allCards = Array.isArray(window.MTG_CARDS) ? window.MTG_CARDS : [];

  // Group cards by set
  const sets = [];
  const setMap = new Map();

  allCards.forEach(card => {
    if (!setMap.has(card.setCode)) {
      const setObj = {
        setCode: card.setCode,
        setName: card.setName,
        cards: []
      };
      setMap.set(card.setCode, setObj);
      sets.push(setObj);
    }
    setMap.get(card.setCode).cards.push(card);
  });

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

  const STORAGE_PREFIX = "mtg_registry_v1";
  const state = {
    currentSet: null,
    filteredCards: [],
    index: 0
  };

  function init() {
    populateSetSelect();
    bindEvents();
    const firstSetCode = sets[0]?.setCode;
    if (firstSetCode) {
      setSelect.value = firstSetCode;
      onSetChange();
    }
  }

  function populateSetSelect() {
    setSelect.innerHTML = "";
    sets.forEach((set) => {
      const option = document.createElement("option");
      option.value = set.setCode;
      option.textContent = `${set.setName} (${set.setCode})`;
      setSelect.appendChild(option);
    });
  }

  function bindEvents() {
    setSelect.addEventListener("change", onSetChange);
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
      if (e.key === "ArrowLeft") {
        moveIndex(-1);
      } else if (e.key === "ArrowRight") {
        moveIndex(1);
      }
    });
  }

  function onSetChange() {
    const setCode = setSelect.value;
    state.currentSet = sets.find((s) => s.setCode === setCode) || null;
    state.index = 0;
    filterCards();
  }

  function filterCards() {
    if (!state.currentSet) {
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
      cardName.textContent = "No cards match this filter";
      metaName.textContent = "";
      metaNumber.textContent = "";
      metaColor.textContent = "";
      metaMana.textContent = "";
      metaType.textContent = "";
      metaSubtype.textContent = "";
      valueHint.textContent = "";
      setBadge.textContent = state.currentSet ? `${state.currentSet.setName} (${state.currentSet.setCode})` : "";
      rarityBadge.textContent = "";
      position.textContent = "0 / 0";
      currentCount.textContent = "0";
      setCountInput.value = "";
      prevCard.disabled = true;
      nextCard.disabled = true;
      return;
    }

    cardName.textContent = card.name;
    metaName.textContent = card.name;
    metaNumber.textContent = `#${card.collectorNumber}`;
    metaColor.textContent = displayColors(card);
    metaMana.textContent = card.manaCost || "—";
    const { mainType, subType } = splitTypeLine(card.typeLine);
    metaType.textContent = mainType || "—";
    metaSubtype.textContent = subType || "—";
    flavorText.textContent = card.flavorText ? `"${card.flavorText}"` : "—";
    valueHint.textContent = card.valueHint || "";
    priceUsd.textContent = formatPrice(card.priceUsd || card.price || null);
    priceFoil.textContent = formatPrice(card.priceUsdFoil || null);
    priceEtched.textContent = formatPrice(card.priceUsdEtched || null);
    setBadge.textContent = `${state.currentSet.setName} (${state.currentSet.setCode})`;
    rarityBadge.textContent = card.rarity;
    rarityBadge.className = `chip ${rarityClass(card.rarity)}`;
    position.textContent = `${state.index + 1} / ${state.filteredCards.length}`;

    if (card.imageUrl) {
      cardImage.src = card.imageUrl;
      cardImage.style.display = "block";
      noImage.style.display = "none";
    } else {
      cardImage.removeAttribute("src");
      cardImage.style.display = "none";
      noImage.style.display = "block";
    }

    const inv = getInventoryForSet(state.currentSet.setCode);
    const count = inv[card.id] ?? 0;
    currentCount.textContent = count;
    setCountInput.value = count;

    prevCard.disabled = state.index === 0;
    nextCard.disabled = state.index >= state.filteredCards.length - 1;
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
    if (val === null || val === undefined || val === "") return "—";
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
