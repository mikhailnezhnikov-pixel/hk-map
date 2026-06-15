const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const FACTION_COLORS = {
  khaki: "#666B50",
  blue: "#4F6680",
  brown: "#735345",
  green: "#4F7A63",
  red: "#8E5654",
  turquoise: "#5D8F8C",
  orange: "#9B805B",
  violet: "#6B5790",
  default: "#5C5C53"
};
const SOURCE_BUILDING_COLOR = [
  "coalesce",
  ["get", "base_color"],
  [
    "match", ["to-string", ["coalesce", ["get", "faction"], ""]],
    "khaki", FACTION_COLORS.khaki, "blue", FACTION_COLORS.blue,
    "brown", FACTION_COLORS.brown, "green", FACTION_COLORS.green,
    "red", FACTION_COLORS.red, "turquoise", FACTION_COLORS.turquoise,
    "orange", FACTION_COLORS.orange, "violet", FACTION_COLORS.violet,
    FACTION_COLORS.default
  ]
];
const HIDDEN_PROPERTY_KEYS = new Set(["crystals_key"]);

let sourceData = EMPTY_COLLECTION;
let visibleData = EMPTY_COLLECTION;
let selectedId = null;
let mapCatalog = { cities: [] };

const elements = Object.fromEntries(
  [
    "citySelect", "mapSelect", "loadSelectedMap", "status", "controls", "visibleCount",
    "totalCount", "investmentCount", "buildingStatusFilters", "diamondFilters", "featureCard",
    "featureName", "featureProperties", "closeCard", "cityBuildingCount", "sectorBuildingCount"
  ].map(id => [id, document.getElementById(id)])
);

const map = new maplibregl.Map({
  container: "map",
  attributionControl: false,
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#34363d" } }]
  },
  center: [139.7639, 35.7108],
  zoom: 14,
  minZoom: 1,
  maxZoom: 21,
  antialias: true
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

map.on("load", () => {
  map.addSource("features", { type: "geojson", data: EMPTY_COLLECTION, promoteId: "building_id" });
  map.addLayer({
    id: "map-areas",
    type: "fill",
    source: "features",
    filter: ["all", ["==", ["get", "is_map_feature"], true], ["==", ["geometry-type"], "Polygon"]],
    paint: {
      "fill-color": [
        "case",
        ["has", "water"], "#293f50",
        ["has", "natural"], "#3b4541",
        ["has", "landuse"], "#3c3f43",
        "#393c42"
      ],
      "fill-opacity": .55
    }
  });
  map.addLayer({
    id: "map-lines",
    type: "line",
    source: "features",
    filter: ["all", ["==", ["get", "is_map_feature"], true], ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]]],
    paint: {
      "line-color": [
        "case",
        ["has", "highway"], "#89909a",
        ["has", "waterway"], "#52758d",
        "#535962"
      ],
      "line-opacity": ["case", ["has", "highway"], .82, .55],
      "line-width": [
        "match", ["get", "highway"],
        "motorway", 4, "trunk", 3.5, "primary", 3, "secondary", 2.5,
        "tertiary", 2, "residential", 1.5, "service", 1,
        .7
      ]
    }
  });
  map.addLayer({
    id: "features-fill",
    type: "fill",
    source: "features",
    filter: ["!=", ["get", "is_map_feature"], true],
    paint: {
      "fill-color": SOURCE_BUILDING_COLOR,
      "fill-opacity": [
        "case",
        ["boolean", ["get", "is_sector"], false], 0,
        ["boolean", ["feature-state", "selected"], false], .95,
        .72
      ]
    }
  });
  map.addLayer({
    id: "features-outline",
    type: "line",
    source: "features",
    filter: ["!=", ["get", "is_map_feature"], true],
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false], "#fff8c9",
        ["boolean", ["get", "is_sector"], false], "rgba(0,0,0,0)",
        [">", ["to-number", ["coalesce", ["get", "diamonds"], 0]], 0], "#55c7ff",
        "#242833"
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false], 3,
        ["boolean", ["get", "is_sector"], false], 0,
        [">", ["to-number", ["coalesce", ["get", "diamonds"], 0]], 0], 2.5,
        1
      ]
    }
  });
  map.addLayer({
    id: "features-points",
    type: "circle",
    source: "features",
    filter: ["all", ["!=", ["get", "is_map_feature"], true], ["==", ["geometry-type"], "Point"]],
    paint: {
      "circle-color": SOURCE_BUILDING_COLOR,
      "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 10, 7],
      "circle-stroke-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false], "#fff8c9",
        [">", ["to-number", ["coalesce", ["get", "diamonds"], 0]], 0], "#55c7ff",
        "#242833"
      ],
      "circle-stroke-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false], 3,
        [">", ["to-number", ["coalesce", ["get", "diamonds"], 0]], 0], 2.5,
        1.5
      ]
    }
  });

  map.on("click", "features-fill", event => showFeature(event.features?.[0]));
  map.on("click", "features-points", event => showFeature(event.features?.[0]));
  map.on("mouseenter", "features-fill", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "features-fill", () => { map.getCanvas().style.cursor = ""; });
  map.on("mouseenter", "features-points", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "features-points", () => { map.getCanvas().style.cursor = ""; });
  loadCatalog();
});

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function isFeatureCollection(value) {
  return value?.type === "FeatureCollection" && Array.isArray(value.features);
}

function normalizeCollection(collection) {
  const features = collection.features
    .filter(feature => feature?.type === "Feature" && feature.geometry)
    .map((feature, index) => {
      const properties = { ...(feature.properties || {}) };
      properties.building_id ||= String(feature.id ?? `feature-${index + 1}`);
      properties.crystals_key = properties.crystals_key ?? (properties.crystals == null ? "NULL" : String(properties.crystals));
      return { ...feature, id: properties.building_id, properties };
    });
  return { type: "FeatureCollection", features };
}

function findCollection(value) {
  if (isFeatureCollection(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const child of Object.values(value)) {
    const found = findCollection(child);
    if (found) return found;
  }
  return null;
}

function extractFromHtml(text) {
  const matches = [...text.matchAll(/const\s+[A-Za-z_$][\w$]*GeoJSON\s*=\s*(\{.*?\});\s*(?=const|let|var|function|<\/script>)/gs)];
  const collections = matches
    .map(match => {
      try { return JSON.parse(match[1]); } catch { return null; }
    })
    .filter(isFeatureCollection);
  return collections.sort((a, b) => b.features.length - a.features.length)[0] || null;
}

async function loadFile(file) {
  const text = await file.text();
  try {
    const lowerName = file.name.toLowerCase();
    const parsed = lowerName.endsWith(".html") || lowerName.endsWith(".htm") ? extractFromHtml(text) : findCollection(JSON.parse(text));
    if (!parsed) throw new Error("GeoJSON FeatureCollection не найден");
    loadCollection(parsed, file.name);
  } catch (error) {
    setStatus(`Ошибка: ${error.message}`, "error");
  }
}

function loadCollection(collection, name) {
  const normalized = normalizeCollection(collection);
  const gameFeatures = normalized.features.filter(feature => feature.properties.is_db_building || feature.properties.is_game);
  sourceData = gameFeatures.length ? { type: "FeatureCollection", features: gameFeatures } : normalized;
  buildBuildingStatusFilters();
  buildDiamondFilters();
  elements.controls.classList.remove("hidden");
  elements.totalCount.textContent = sourceData.features.length.toLocaleString("ru-RU");
  elements.investmentCount.textContent = sourceData.features.filter(feature => feature.properties.is_investment).length.toLocaleString("ru-RU");
  setStatus(`${name}: загружено ${sourceData.features.length} объектов`, "ok");
  applyFilters();
  fitToData(sourceData);
  if (sourceData.features.length === 1) showFeature(sourceData.features[0]);
}

function isOpenedBuilding(properties) {
  if (properties.player_owned != null) return properties.player_owned === true || properties.player_owned === "true";
  const crystals = String(properties.crystals_key ?? "NULL");
  return crystals !== "NULL" && crystals !== "OTHER";
}

function buildBuildingStatusFilters() {
  const buildings = sourceData.features.filter(feature => !feature.properties.is_sector);
  const statuses = [
    { value: "OPEN", label: "Открыто", present: buildings.some(feature => isOpenedBuilding(feature.properties)) },
    { value: "CLOSED", label: "Не открыто", present: buildings.some(feature => !isOpenedBuilding(feature.properties)) }
  ];
  elements.buildingStatusFilters.replaceChildren();
  statuses.filter(status => status.present).forEach(status => {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = status.value;
    input.checked = true;
    input.addEventListener("change", applyFilters);
    label.append(input, document.createTextNode(status.label));
    elements.buildingStatusFilters.append(label);
  });
}

function buildDiamondFilters() {
  const buildings = sourceData.features.filter(feature => !feature.properties.is_sector && !feature.properties.is_map_feature);
  const values = [...new Set(buildings.map(feature => Number(feature.properties.diamonds || 0)))].sort((a, b) => a - b);
  elements.diamondFilters.replaceChildren();
  values.forEach(value => {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(value);
    input.checked = true;
    input.addEventListener("change", applyFilters);
    const labelText = value === 0 ? "Без кристаллов" : `${value} кр.`;
    label.append(input, document.createTextNode(labelText));
    elements.diamondFilters.append(label);
  });
}

function searchable(properties) {
  return Object.values(properties).map(value => String(value ?? "")).join(" ").toLocaleLowerCase("ru-RU");
}

function applyFilters() {
  const statuses = new Set([...elements.buildingStatusFilters.querySelectorAll("input:checked")].map(input => input.value));
  const diamondStatuses = new Set([...elements.diamondFilters.querySelectorAll("input:checked")].map(input => input.value));
  visibleData = {
    type: "FeatureCollection",
    features: sourceData.features.filter(feature => {
      const properties = feature.properties;
      if (properties.is_sector || properties.is_map_feature) return true;
      const status = isOpenedBuilding(properties) ? "OPEN" : "CLOSED";
      if (!statuses.has(status)) return false;
      const diamonds = String(Number(properties.diamonds || 0));
      if (!diamondStatuses.has(diamonds)) return false;
      return true;
    })
  };
  map.getSource("features")?.setData(visibleData);
  elements.visibleCount.textContent = visibleData.features.length.toLocaleString("ru-RU");
  clearSelection();
}

function coordinatesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates];
  return geometry.coordinates.flat(Infinity).reduce((pairs, value, index, all) => {
    if (typeof value === "number" && typeof all[index + 1] === "number" && index % 2 === 0) pairs.push([value, all[index + 1]]);
    return pairs;
  }, []);
}

function fitToData(collection) {
  const coordinates = collection.features.flatMap(feature => coordinatesOf(feature.geometry));
  if (!coordinates.length) return;
  const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
  map.fitBounds(bounds, { padding: 55, duration: 500, maxZoom: 18 });
}

function showFeature(feature) {
  if (!feature) return;
  clearSelection();
  selectedId = feature.properties.building_id;
  map.setFeatureState({ source: "features", id: selectedId }, { selected: true });
  elements.featureCard.classList.remove("hidden");
  elements.featureName.textContent = feature.properties["name:ru"] || feature.properties.name || feature.properties["name:en"] || selectedId;
  elements.featureProperties.replaceChildren();
  Object.entries(feature.properties)
    .filter(([key, value]) => value !== "" && value != null && !HIDDEN_PROPERTY_KEYS.has(key) && !key.toLowerCase().includes("tier"))
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "property";
      const keyNode = document.createElement("span");
      const valueNode = document.createElement("span");
      keyNode.textContent = key;
      valueNode.textContent = String(value);
      row.append(keyNode, valueNode);
      elements.featureProperties.append(row);
    });
}

function clearSelection() {
  if (selectedId != null) map.removeFeatureState({ source: "features", id: selectedId });
  selectedId = null;
  elements.featureCard.classList.add("hidden");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function loadCatalog() {
  try {
    const response = await fetch("maps/catalog.json");
    if (!response.ok) throw new Error("каталог не найден");
    mapCatalog = await response.json();
    elements.citySelect.replaceChildren();
    mapCatalog.cities.forEach(city => {
      const option = document.createElement("option");
      option.value = city.id;
      option.textContent = city.name;
      elements.citySelect.append(option);
    });
    refreshMapSelect();
    await loadSelectedCatalogMap();
  } catch {
    setStatus("Запустите сайт через «ОТКРЫТЬ КАРТУ.cmd» или загрузите файл вручную.", "error");
  }
}

function refreshMapSelect() {
  const city = mapCatalog.cities.find(item => item.id === elements.citySelect.value) || mapCatalog.cities[0];
  elements.mapSelect.replaceChildren();
  city?.maps.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    elements.mapSelect.append(option);
  });
  updateScopeStats();
}

function formatBuildingStats(stats) {
  return `${Number(stats?.total || 0).toLocaleString("ru-RU")} / ${Number(stats?.opened || 0).toLocaleString("ru-RU")}`;
}

function updateScopeStats() {
  const city = mapCatalog.cities.find(item => item.id === elements.citySelect.value) || mapCatalog.cities[0];
  const item = city?.maps.find(mapItem => mapItem.id === elements.mapSelect.value);
  elements.cityBuildingCount.textContent = formatBuildingStats(city?.stats);
  elements.sectorBuildingCount.textContent = formatBuildingStats(item?.stats);
}

async function loadSelectedCatalogMap() {
  const city = mapCatalog.cities.find(item => item.id === elements.citySelect.value);
  const item = city?.maps.find(mapItem => mapItem.id === elements.mapSelect.value);
  if (!item) return;
  try {
    setStatus(`Загрузка: ${city.name} ${item.name}...`);
    const response = await fetch(item.file);
    if (!response.ok) throw new Error("файл карты не найден");
    loadCollection(await response.json(), `${city.name} ${item.name}`);
  } catch (error) {
    setStatus(`Ошибка: ${error.message}`, "error");
  }
}

elements.citySelect.addEventListener("change", refreshMapSelect);
elements.mapSelect.addEventListener("change", () => {
  updateScopeStats();
  loadSelectedCatalogMap();
});
elements.loadSelectedMap.addEventListener("click", loadSelectedCatalogMap);
elements.closeCard.addEventListener("click", clearSelection);
