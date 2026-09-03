"use strict";

const EN = {
  title: "BeeEmUu Diagnostics",
  brand_sub: "Integrated Diagnostics",
  no_vehicle: "No vehicle connected",
  sim: "Simulator (virtual E90)",
  kdcan: "K+DCAN cable",
  enet: "ENET cable",
  connection: "Connection",
  discover: "Discover",
  connect: "Connect",
  mode_basic: "Basic",
  mode_advanced: "Advanced",
  mode_developer: "Developer",
  tab_vehicle: "Vehicle Test",
  tab_live: "Live Data",
  tab_logging: "Logging",
  tab_explorer: "Parameter Explorer",
  tab_info: "Vehicle Info",
  tab_service: "Service Functions",
  tab_diagnostics: "Diagnostics",
  tab_snapshots: "Snapshots",
  control_units: "Control units",
  run_vehicle_test: "Run vehicle test",
  fault_memory: "Fault memory",
  read: "Read",
  export_csv: "Export CSV",
  clear_faults: "Clear fault memory",
  record_history: "Record history",
  select_ecu: "Select a control unit.",
  live_values: "Live values —",
  poll: "Poll",
  save_snapshot: "Save snapshot",
  live_gauges: "Live Gauges",
  start_can: "Start CAN listener",
  data_logging: "Data logging —",
  start_recording: "Start recording",
  share_log: "Share log",
  include_units: "Include units row",
  export_png: "Export PNG",
  export_svg: "Export SVG",
  histogram: "Histogram",
  compare_logs: "Compare logs",
  clear: "Clear",
  load_session: "Load session",
  import_external: "Import external log",
  vehicle_information: "Vehicle information",
  share_export: "Share / Export ▾",
  read_vehicle: "Read vehicle",
  export_report: "Export report",
  export_snapshot: "Export snapshot",
  service_manual: "Service manual",
  conn_kdcan: "K+DCAN",
  conn_enet: "ENET",
};

const DE = {
  title: "BeeEmUu Diagnostik",
  brand_sub: "Integrierte Diagnose",
  no_vehicle: "Kein Fahrzeug verbunden",
  sim: "Simulator (virtueller E90)",
  kdcan: "K+DCAN-Kabel",
  enet: "ENET-Kabel",
  connection: "Verbindung",
  discover: "Suchen",
  connect: "Verbinden",
  mode_basic: "Einfach",
  mode_advanced: "Erweitert",
  mode_developer: "Entwickler",
  tab_vehicle: "Fahrzeugtest",
  tab_live: "Livedaten",
  tab_logging: "Protokoll",
  tab_explorer: "Parameter-Explorer",
  tab_info: "Fahrzeuginfos",
  tab_service: "Servicefunktionen",
  tab_diagnostics: "Diagnose",
  tab_snapshots: "Snapshots",
  control_units: "Steuergeräte",
  run_vehicle_test: "Fahrzeugtest starten",
  fault_memory: "Fehlerspeicher",
  read: "Lesen",
  export_csv: "CSV exportieren",
  clear_faults: "Fehlerspeicher löschen",
  record_history: "Verlauf aufzeichnen",
  select_ecu: "Steuergerät wählen.",
  live_values: "Livewerte —",
  poll: "Abfragen",
  save_snapshot: "Snapshot speichern",
  live_gauges: "Live-Anzeigen",
  start_can: "CAN-Listener starten",
  data_logging: "Messprotokoll —",
  start_recording: "Aufnahme starten",
  share_log: "Protokoll teilen",
  include_units: "Einheitenzeile",
  export_png: "PNG exportieren",
  export_svg: "SVG exportieren",
  histogram: "Histogramm",
  compare_logs: "Protokolle vergleichen",
  clear: "Leeren",
  load_session: "Sitzung laden",
  import_external: "Externes Protokoll importieren",
  vehicle_information: "Fahrzeuginformationen",
  share_export: "Teilen / Export ▾",
  read_vehicle: "Fahrzeug auslesen",
  export_report: "Bericht exportieren",
  export_snapshot: "Snapshot exportieren",
  service_manual: "Werkstatthandbuch",
  conn_kdcan: "K+DCAN",
  conn_enet: "ENET",
};

const FR = {
  title: "BeeEmUu Diagnostic",
  brand_sub: "Diagnostic intégré",
  no_vehicle: "Aucun véhicule connecté",
  sim: "Simulateur (E90 virtuel)",
  kdcan: "Câble K+DCAN",
  enet: "Câble ENET",
  connection: "Connexion",
  discover: "Découvrir",
  connect: "Connecter",
  mode_basic: "Basique",
  mode_advanced: "Avancé",
  mode_developer: "Développeur",
  tab_vehicle: "Test véhicule",
  tab_live: "Données live",
  tab_logging: "Enregistrement",
  tab_explorer: "Explorateur",
  tab_info: "Infos véhicule",
  tab_service: "Fonctions service",
  tab_diagnostics: "Diagnostic",
  tab_snapshots: "Instantanés",
  control_units: "Calculateurs",
  run_vehicle_test: "Lancer le test",
  fault_memory: "Mémoire défauts",
  read: "Lire",
  export_csv: "Exporter CSV",
  clear_faults: "Effacer les défauts",
  record_history: "Enregistrer l'historique",
  select_ecu: "Sélectionner un calculateur.",
  live_values: "Valeurs live —",
  poll: "Interroger",
  save_snapshot: "Sauver l'instantané",
  live_gauges: "Jauges live",
  start_can: "Démarrer l'écoute CAN",
  data_logging: "Enregistrement —",
  start_recording: "Démarrer",
  share_log: "Partager le log",
  include_units: "Inclure les unités",
  export_png: "Exporter PNG",
  export_svg: "Exporter SVG",
  histogram: "Histogramme",
  compare_logs: "Comparer les logs",
  clear: "Effacer",
  load_session: "Charger la session",
  import_external: "Importer un log externe",
  vehicle_information: "Informations véhicule",
  share_export: "Partager / Exporter ▾",
  read_vehicle: "Lire le véhicule",
  export_report: "Exporter le rapport",
  export_snapshot: "Exporter l'instantané",
  service_manual: "Manuel d'atelier",
  conn_kdcan: "K+DCAN",
  conn_enet: "ENET",
};

const DICTS = { en: EN, de: DE, fr: FR };
const STORAGE_KEY = "beeemuu-lang";
let currentLang = "en";

function t(key, lang) {
  const code = lang || currentLang;
  const dict = DICTS[code] || EN;
  if (Object.prototype.hasOwnProperty.call(dict, key) && dict[key]) return dict[key];
  if (Object.prototype.hasOwnProperty.call(EN, key) && EN[key]) return EN[key];
  return key;
}

function setLang(lang) {
  currentLang = DICTS[lang] ? lang : "en";
  try { localStorage.setItem(STORAGE_KEY, currentLang); } catch (_) {}
  return currentLang;
}

function getLang() {
  return currentLang;
}

function apply(root) {
  const doc = root || (typeof document !== "undefined" ? document : null);
  if (!doc) return;
  if (doc.documentElement) doc.documentElement.lang = currentLang;
  if (typeof document !== "undefined") document.title = t("title");
  const nodes = doc.querySelectorAll ? doc.querySelectorAll("[data-i18n]") : [];
  nodes.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });
  const titles = doc.querySelectorAll ? doc.querySelectorAll("[data-i18n-title]") : [];
  titles.forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });
}

function init(root) {
  let lang = "en";
  try { lang = localStorage.getItem(STORAGE_KEY) || "en"; } catch (_) {}
  setLang(lang);
  apply(root);
  return currentLang;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { t, setLang, getLang, apply, init, DICTS, STORAGE_KEY };
}
if (typeof window !== "undefined") {
  window.beeemuuI18n = { t, setLang, getLang, apply, init, DICTS, STORAGE_KEY };
}
