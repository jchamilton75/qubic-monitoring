"use client";

/* eslint-disable @next/next/no-img-element -- local scientific assets are served directly by the Vinext prototype */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChannelStatus = "fresh" | "delayed" | "stale" | "missing";

// Point tuples carry the displayed value plus the raw extrema covered by the
// same aggregate bucket. Existing consumers can keep using [0] and [1], while
// decimators and future min/max envelopes can use [2] and [3].
type ChannelPoint = [timeMs: number, value: number, minimum?: number, maximum?: number];

type Channel = {
  id: string;
  sourceName: string;
  label: string;
  shortLabel: string;
  group: string;
  category: string;
  unit: string;
  color: string;
  source: string;
  aggregation?: "mean" | "bucket_max" | "bucket_max_10m";
  firstMs: number;
  latestMs: number | null;
  latestValue: number | null;
  ageMs: number | null;
  status: ChannelStatus;
  sampleCount: number;
  suspectCount: number;
  invalidCount: number;
  points: ChannelPoint[];
};

type CryogenicEvent = {
  id: string;
  type: string;
  label: string;
  description: string;
  timeMs: number | null;
  status: "detected" | "pending";
  confidence: string;
};

type TouchEvent = {
  id: string;
  startMs: number;
  peakMs: number;
  endMs: number;
  peakValue: number;
  peakRatio: number;
  baseline: number;
  threshold: number;
};

type MonitoringSnapshot = {
  generatedAtMs: number;
  latestGlobalMs: number;
  analysis?: {
    engine: string;
    schemaVersion: number;
    generatedAtMs: number;
  };
  cooldown: {
    id: string;
    label: string;
    startTimeMs: number;
    status: string;
    phase: string;
  };
  events: CryogenicEvent[];
  touchEvents?: TouchEvent[];
  channels: Channel[];
  sourceHealth: {
    total: number;
    fresh: number;
    delayed: number;
    stale: number;
    missing: number;
  };
};

type ForecastPoint = {
  timeMs: number;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
};

type WeatherForecast = {
  generatedAtMs: number;
  source: string;
  points: ForecastPoint[];
};

type ZoomDomain = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  range: TimeRange;
};

type ZoomSelection = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type ChartDatum = {
  timeMs: number;
  [key: string]: number | [number, number];
};

type HoverCurve = {
  key: string;
  label: string;
  unit: string;
  color: string;
  points: Array<{ timeMs: number; value: number }>;
};

type HoverCoordinate = { x: number; y: number } | null;
type HoverPointerStore = {
  getSnapshot: () => HoverCoordinate;
  subscribe: (listener: () => void) => () => void;
  set: (coordinate: HoverCoordinate) => void;
};

function createHoverPointerStore(): HoverPointerStore {
  let coordinate: HoverCoordinate = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => coordinate,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (nextCoordinate) => {
      if (coordinate?.x === nextCoordinate?.x && coordinate?.y === nextCoordinate?.y) return;
      coordinate = nextCoordinate;
      listeners.forEach((listener) => listener());
    },
  };
}

type View = "monitoring" | "cycles" | "compare" | "sources" | "webcams";
type HousekeepingView = "temperatures" | "pressure" | "touch" | "compressors" | "weather";
type TimeRange = "1h" | "2h" | "48h" | "7d" | "30d" | "all";
type Language = "en" | "fr" | "es" | "it";
type DisplayTimeZone = "UTC" | "Europe/Paris" | "America/Argentina/Buenos_Aires";

const locales: Record<Language, string> = {
  en: "en-GB",
  fr: "fr-FR",
  es: "es-AR",
  it: "it-IT",
};

const languageOptions: { id: Language; label: string; short: string }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "fr", label: "Français", short: "FR" },
  { id: "es", label: "Español", short: "ES" },
  { id: "it", label: "Italiano", short: "IT" },
];

const timeZoneOptions: { id: DisplayTimeZone; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "Europe/Paris", label: "Paris / Roma" },
  { id: "America/Argentina/Buenos_Aires", label: "Argentina" },
];

const messages: Record<Language, Record<string, string>> = {
  en: {
    "nav.monitoring": "Cooldown Monitoring",
    "nav.cycles": "Fridges Cycles Analysis",
    "nav.compare": "Cooldown Comparison",
    "nav.sources": "Quality / Sources",
    "nav.webcams": "Webcams",
    "eyebrow.monitoring": "Live telemetry",
    "eyebrow.cycles": "Sub-K",
    "eyebrow.compare": "Analysis",
    "eyebrow.sources": "Quality",
    "eyebrow.webcams": "Observatory",
    "nav.temperatures": "Temperatures",
    "nav.pressure": "Cryostat pressure",
    "nav.touch": "Touch & 1 K",
    "nav.compressors": "Compressors",
    "nav.weather": "Site weather",
    "eyebrow.temperatures": "Instrument",
    "eyebrow.pressure": "Vacuum",
    "eyebrow.touch": "Correlation",
    "eyebrow.compressors": "Pulse tubes",
    "eyebrow.weather": "Alto Chorrillos",
    "nav.overview": "Current view",
    "nav.cold": "Cold phase",
    "eyebrow.overview": "Monitoring",
    "eyebrow.cold": "Sub-K",
    "range.all": "All",
    "status.fresh": "Up to date",
    "status.delayed": "Delayed",
    "status.stale": "Stale",
    "status.missing": "Missing",
    notAvailable: "Not available",
    neverReceived: "never received",
    ageMinutes: "{count} min ago",
    ageHours: "{count} h ago",
    ageDays: "{count} d ago",
    loading: "Reading the instrument…",
    loadError: "Local data are not available yet.",
    loadErrorHelp: "Refresh the importer, then reload this page.",
    warningTitle: "Partial telemetry stream",
    warningBody: "{count} source(s) have no recent data — curves are never extended past their last measurement.",
    mainTemperatures: "Main temperatures",
    cryogenicEvolution: "Cryogenic evolution",
    chartCopy: "Per-channel aggregates. Each source keeps its own timeline and freshness.",
    timeWindow: "Time window",
    boxZoom: "Box zoom",
    dragToZoom: "Drag a rectangle over the curve to zoom both axes",
    resetZoom: "Reset zoom",
    yAxis: "Y-axis",
    yMinimum: "Minimum",
    yMaximum: "Maximum",
    autoScale: "Auto",
    logScale: "Log scale",
    visibleChannels: "Visible channels",
    emptyChart: "No visible channel in this time range.",
    chartHint: "Use the lower strip to zoom and move through time.",
    temperaturesCopy: "All instrument temperature channels. Select any combination using the human name and source-file identifier.",
    pressureTitle: "Cryostat pressure",
    pressureCopy: "Dedicated logarithmic view of the vacuum pressure.",
    touchTitle: "Touch signal aligned with the 1 K stage",
    touchCopy: "Touch uses the maximum value in each resampling bucket and logarithmic normalization so brief mechanical heat-switch openings remain visible. Both signals are normalized independently, and the plot stops 24 hours after the main cooldown ends.",
    touchBucketMaximum: "bucket maximum",
    fridgeBucketMaximum: "10 min maximum",
    mhsOperations: "Detected MHS open/close operations",
    mhsOperationsCopy: "Detected automatically during the main cooldown. Select an operation to inspect it.",
    mhsOperation: "MHS {count}",
    mhsPeak: "peak {value}",
    backToTouchOverview: "Back to full Touch view",
    normalizedSignal: "Normalized signal",
    compressorTitle: "Pulse-tube compressors",
    compressorCopy: "Helium, inlet and outlet temperatures, inlet pressure and live online state for both compressors.",
    initialStartup: "Initial start",
    weatherTitle: "Weather at Alto Chorrillos",
    weatherCopy: "Outside weather and indoor conditions, including atmospheric pressure, wind speed and wind direction.",
    forecast: "Forecast",
    forecastUnavailable: "Forecast temporarily unavailable",
    forecastSource: "Open-Meteo forecast · QUBIC coordinates and 4,869 m elevation",
    diurnalReference: "7-day RMS envelope",
    diurnalReferenceCopy: "Transparent ± RMS envelope centred on the current curve, estimated from the previous 7 days",
    expectedPattern: "7-day RMS envelope",
    windRoseTitle: "Wind speed and arrival direction",
    windRoseCopy: "The colour map uses the selected density period; recent samples fade with age over the displayed time window.",
    windFrom: "Wind from {direction}",
    fullCooldownDensity: "Full Cooldown Density",
    last24hDensity: "Last 24h",
    last7dDensity: "Last 7 days",
    selectAll: "Select all",
    clearSelection: "Clear",
    online: "Online",
    offline: "Offline",
    automaticMarkers: "Automatic markers",
    cryogenicTimeline: "Cryogenic timeline",
    timelinePhaseData: "Beginning of data",
    timelinePhaseDataCopy: "First valid sample in the current cooldown",
    timelinePhasePumping: "Pumping",
    timelinePhasePumpingCopy: "Cryostat pressure below 300 mbar",
    timelinePhaseMain: "Main cooldown",
    timelinePhaseMainCopy: "PTC startup to both second stages below 4.5 K",
    timelinePhaseSubK: "Sub-K cycles",
    timelinePhaseSubKCopy: "First 300 mK and 1 K refrigerator cycles",
    review: "Review",
    editingSoon: "Editing will be added next",
    toDetect: "To be detected",
    candidateDetection: "Candidate detection",
    insufficientData: "Insufficient data",
    subKSequence: "Sub-K sequence",
    coldTitle: "The cold phase becomes a dedicated analysis object.",
    coldCopy: "It starts after the 4 K stage is confirmed stable and contains the 1 K and 300 mK cycles detected from heaters, MHS states and temperatures.",
    latest1K: "Latest 1 K signal",
    phase1Title: "Main cooldown",
    phase1Copy: "The 260 K marker was detected on the descending 1 K stage curve.",
    phase2Title: "4 K stability",
    phase2Copy: "Waiting for a recent 4 K stream to confirm the threshold and duration.",
    phase3Title: "Sub-K cycles",
    phase3Copy: "The structure is ready to segment and compare the next cycles.",
    nextCapability: "Next capability",
    cycleReferenceTitle: "Current cycle vs reference",
    cycleReferenceCopy: "Mean, RMS, median and percentile envelopes will be computed after cycle start and end events are validated.",
    referenceBand: "Reference ± dispersion",
    comparisonLab: "Comparison laboratory",
    comparisonTitle: "Align cooldowns on the same event",
    timeMarker: "Time reference",
    crossing260: "Descending crossing at 260 K",
    stable4K: "Stable 4 K stage — pending validation",
    cycleStart: "Sub-K cycle start — phase 2",
    cooldowns: "Cooldowns",
    current: "Current",
    toImport: "To import",
    selectedCooldowns: "{count} cooldown(s) selected",
    comparisonEmpty: "The current cooldown is ready. Historical curves will be added incrementally and will never be reread for every display.",
    acquisitionQuality: "Acquisition quality",
    perChannelFreshness: "Per-channel freshness",
    sourceCopy: "The displayed date comes from the latest valid measurement in each file.",
    importedSources: "imported sources",
    tableChannel: "Channel",
    tableStatus: "Status",
    tableLatest: "Latest measurement",
    tableValue: "Value",
    tableSamples: "Samples",
    tableQuality: "Quality",
    valid: "Valid",
    suspect: "{count} suspect",
    webcams: "QUBIC webcams",
    webcamsLater: "Live views from Alto Chorrillos",
    webcamsTitle: "QUBIC observatory webcams",
    webcamsCopy: "Live images relayed securely from the three site cameras. Access credentials stay on the monitoring server.",
    cameraLive: "Live",
    cameraUnavailable: "Camera temporarily unavailable",
    camera1: "Camera 1",
    camera2: "Camera 2",
    camera3: "Camera 3",
    enlarge: "Enlarge",
    captureImage: "Capture image",
    recordVideo: "Record video",
    stopRecording: "Stop recording",
    recording: "Recording",
    recordingLimit: "Time-lapse recording · 1 frame/s · 30 s maximum",
    videoUnsupported: "Video recording is not supported by this browser",
    captureFailed: "Capture failed",
    housekeepingTitle: "Housekeeping",
    housekeepingCopy: "Choose the telemetry family to display below.",
    availableChannels: "{count} channels available",
    threeSiteCameras: "3 site cameras",
    navigation: "Main navigation",
    timezone: "Time zone",
    displayedCooldown: "Displayed cooldown",
    currentCooldown: "Current cooldown",
    latestGlobal: "Latest global point",
    heroTitle: "Live view of the current cooldown.",
    heroCopy: "This view uses the newest local cooldown directory. Each source keeps its own chronology and quality status.",
    metric1K: "1 K stage",
    metric4K: "4 K filters",
    metricPressure: "Cryostat pressure",
    metricInside: "Indoor temperature",
    snapshotGenerated: "Local snapshot generated on {date}",
    automaticRefresh: "Automatic refresh · no page reload",
    phaseColdPartial: "Cold phase — partial stream",
    phaseCooldown: "Cooldown",
    observatoryAlt: "QUBIC Observatory at Alto Chorrillos",
    daysBefore: "−2 days",
    eventT0: "Event t₀",
    daysAfter: "+12 days",
    "channel.avs47_1_ch1": "1 K stage",
    "channel.avs47_1_ch4": "1 K fridge cold head",
    "channel.avs47_1_ch6": "300 mK fridge cold head",
    "channel.temperature06": "4 K filters",
    "channel.pressure1": "Cryostat pressure",
    "channel.inside_temperature": "Indoor temperature",
    "channel.inside_humidity": "Indoor humidity",
    "event.beginning-of-data.title": "Beginning of data",
    "event.beginning-of-data.copy": "First valid sample in the current cooldown",
    "event.pumping.title": "Pressure below 300 mbar",
    "event.pumping.copy": "Pumping detected from the cryostat pressure",
    "event.ptc1-on.title": "PTC 1 ON",
    "event.ptc1-on.copy": "Pulse-tube compressor 1 is running",
    "event.ptc2-on.title": "PTC 2 ON",
    "event.ptc2-on.copy": "Pulse-tube compressor 2 is running",
    "event.pt1-s2-260k.title": "PT1 S2 CH below 260 K",
    "event.pt1-s2-260k.copy": "Second stage of PT1 entered the 270–250 K cooldown phase",
    "event.pt2-s2-260k.title": "PT2 S2 CH below 260 K",
    "event.pt2-s2-260k.copy": "Second stage of PT2 entered the 270–250 K cooldown phase",
    "event.pt1-s1-50k.title": "PT1 S1 below 50 K",
    "event.pt1-s1-50k.copy": "First stage of PT1 reached the 40 K regime",
    "event.pt2-s1-50k.title": "PT2 S1 below 50 K",
    "event.pt2-s1-50k.copy": "First stage of PT2 reached the 40 K regime",
    "event.pt1-s2-4p5k.title": "PT1 S2 CH below 4.5 K",
    "event.pt1-s2-4p5k.copy": "Second stage of PT1 reached the 4 K regime",
    "event.pt2-s2-4p5k.title": "PT2 S2 CH below 4.5 K",
    "event.pt2-s2-4p5k.copy": "Second stage of PT2 reached the 4 K regime",
    "event.main-cooldown-complete.title": "End of the main cooldown phase",
    "event.main-cooldown-complete.copy": "Both second PTC stages are below 4.5 K",
    "event.300mk-fridge-below-3k.title": "300 mK fridge cold head below 3 K",
    "event.300mk-fridge-below-3k.copy": "First 300 mK fridge cycle",
    "event.300mk-fridge-below-350mk.title": "300 mK fridge cold head below 350 mK",
    "event.300mk-fridge-below-350mk.copy": "First 300 mK fridge cycle",
    "event.1k-fridge-below-3k.title": "1 K fridge cold head below 3 K",
    "event.1k-fridge-below-3k.copy": "First 1 K fridge cycle",
    "event.1k-fridge-below-1k.title": "1 K fridge cold head below 1 K",
    "event.1k-fridge-below-1k.copy": "First 1 K fridge cycle",
    "event.base-1k.title": "1 K stage below 1.2 K",
    "event.base-1k.copy": "Automatic candidate — stability to be confirmed",
  },
  fr: {
    "nav.monitoring": "Monitoring du cooldown", "nav.cycles": "Analyse des cycles des frigos", "nav.compare": "Comparaison des cooldowns", "nav.sources": "Qualité / Sources", "nav.webcams": "Webcams",
    "eyebrow.monitoring": "Télémétrie en direct", "eyebrow.cycles": "Sub-K", "eyebrow.compare": "Analyse", "eyebrow.sources": "Qualité", "eyebrow.webcams": "Observatoire",
    "nav.temperatures": "Températures", "nav.pressure": "Pression cryostat", "nav.touch": "Touch & 1 K", "nav.compressors": "Compresseurs", "nav.weather": "Météo du site",
    "eyebrow.temperatures": "Instrument", "eyebrow.pressure": "Vide", "eyebrow.touch": "Corrélation", "eyebrow.compressors": "Tubes pulsés", "eyebrow.weather": "Alto Chorrillos",
    "nav.overview": "Vue actuelle", "nav.cold": "Phase froide",
    "eyebrow.overview": "Monitoring", "eyebrow.cold": "Sub-K",
    "range.all": "Tout", "status.fresh": "À jour", "status.delayed": "En retard", "status.stale": "Ancien", "status.missing": "Absent",
    notAvailable: "Non disponible", neverReceived: "jamais reçu", ageMinutes: "il y a {count} min", ageHours: "il y a {count} h", ageDays: "il y a {count} j",
    loading: "Lecture de l’instrument…", loadError: "Les données locales ne sont pas encore disponibles.", loadErrorHelp: "Actualisez l’importeur puis rechargez cette page.",
    warningTitle: "Flux de télémétrie partiel", warningBody: "{count} source(s) sans donnée récente — les courbes ne sont jamais prolongées au-delà de leur dernière mesure.",
    mainTemperatures: "Températures principales", cryogenicEvolution: "Évolution cryogénique", chartCopy: "Agrégats par canal. Chaque source conserve sa propre chronologie et fraîcheur.",
    temperaturesCopy: "Tous les canaux de température de l’instrument. Sélectionnez-les par leur nom humain et leur identifiant de fichier.", pressureTitle: "Pression du cryostat", pressureCopy: "Vue logarithmique dédiée à la pression du vide.", touchTitle: "Signal Touch aligné sur l’étage 1 K", touchCopy: "Le Touch utilise le maximum de chaque paquet de rééchantillonnage puis une normalisation logarithmique afin de conserver les ouvertures brèves du switch thermique mécanique. Les deux signaux sont normalisés indépendamment et le graphique s’arrête 24 heures après la fin du refroidissement principal.", touchBucketMaximum: "maximum du paquet", fridgeBucketMaximum: "maximum sur 10 min", mhsOperations: "Ouvertures/fermetures MHS détectées", mhsOperationsCopy: "Détection automatique pendant le refroidissement principal. Sélectionnez une manœuvre pour l’examiner.", mhsOperation: "MHS {count}", mhsPeak: "pic {value}", backToTouchOverview: "Revenir à la vue Touch complète", normalizedSignal: "Signal normalisé", compressorTitle: "Compresseurs des tubes pulsés", compressorCopy: "Températures hélium, entrée et sortie, pression d’entrée et état des deux compresseurs.", weatherTitle: "Météo à Alto Chorrillos", weatherCopy: "Conditions extérieures et intérieures, pression atmosphérique, vitesse et direction du vent.", selectAll: "Tout sélectionner", clearSelection: "Effacer", online: "En ligne", offline: "Hors ligne",
    timeWindow: "Fenêtre temporelle", boxZoom: "Zoom rectangle", dragToZoom: "Tracez un rectangle sur la courbe pour zoomer sur les deux axes", resetZoom: "Réinitialiser le zoom", yAxis: "Axe Y", yMinimum: "Minimum", yMaximum: "Maximum", autoScale: "Auto", logScale: "Échelle log", visibleChannels: "Canaux visibles", emptyChart: "Aucun canal visible dans cette période.", chartHint: "Utilisez la bande inférieure pour zoomer et vous déplacer dans le temps.",
    forecast: "Prévisions", forecastUnavailable: "Prévisions temporairement indisponibles", forecastSource: "Prévisions Open-Meteo · coordonnées QUBIC et altitude 4 869 m", diurnalReference: "Enveloppe RMS sur 7 jours", diurnalReferenceCopy: "Enveloppe transparente ± RMS centrée sur la courbe actuelle et estimée sur les 7 jours précédents", expectedPattern: "Enveloppe RMS sur 7 jours", windRoseTitle: "Vitesse et direction d’arrivée du vent", windRoseCopy: "La carte de couleurs utilise la période de densité choisie ; les mesures récentes s’estompent avec leur âge sur la fenêtre temporelle affichée.", windFrom: "Vent venant de {direction}", fullCooldownDensity: "Cooldown complet", last24hDensity: "Dernières 24 h", last7dDensity: "7 derniers jours",
    automaticMarkers: "Repères automatiques", cryogenicTimeline: "Chronologie cryogénique", timelinePhaseData: "Début des données", timelinePhaseDataCopy: "Premier échantillon valide du cooldown courant", timelinePhasePumping: "Pompage", timelinePhasePumpingCopy: "Pression du cryostat sous 300 mbar", timelinePhaseMain: "Refroidissement principal", timelinePhaseMainCopy: "Du démarrage des PTC aux deux seconds étages sous 4,5 K", timelinePhaseSubK: "Cyclages sub-K", timelinePhaseSubKCopy: "Premiers cyclages des réfrigérateurs 300 mK et 1 K", review: "Réviser", editingSoon: "Édition ajoutée prochainement", toDetect: "À détecter", candidateDetection: "Détection candidate", insufficientData: "Données insuffisantes",
    subKSequence: "Séquence sub-K", coldTitle: "La phase froide devient un objet d’analyse dédié.", coldCopy: "Elle démarre après confirmation de la stabilité de l’étage 4 K et contient les cyclages 1 K et 300 mK détectés via les chauffages, MHS et températures.", latest1K: "Dernier signal 1 K",
    phase1Title: "Refroidissement principal", phase1Copy: "Le repère 260 K a été détecté sur la descente de l’étage 1 K.", phase2Title: "Stabilité 4 K", phase2Copy: "En attente d’un flux 4 K récent pour confirmer le seuil et sa durée.", phase3Title: "Cyclages sub-K", phase3Copy: "La structure est prête à segmenter et comparer les prochains cycles.",
    nextCapability: "Prochaine capacité", cycleReferenceTitle: "Cycle courant vs référence", cycleReferenceCopy: "Moyenne, RMS, médiane et percentiles seront calculés après validation des événements de début et de fin de cycle.", referenceBand: "Référence ± dispersion",
    comparisonLab: "Laboratoire de comparaison", comparisonTitle: "Recaler les cooldowns sur un même événement", timeMarker: "Repère temporel", crossing260: "Passage descendant à 260 K", stable4K: "Étage 4 K stable — validation en attente", cycleStart: "Début de cyclage sub-K — phase 2", cooldowns: "Cooldowns", current: "Courant", toImport: "À importer", selectedCooldowns: "{count} cooldown(s) sélectionné(s)", comparisonEmpty: "Le cooldown courant est prêt. Les courbes historiques seront ajoutées progressivement et ne seront jamais relues à chaque affichage.",
    acquisitionQuality: "Qualité des acquisitions", perChannelFreshness: "Fraîcheur canal par canal", sourceCopy: "La date affichée provient de la dernière mesure valide de chaque fichier.", importedSources: "sources importées", tableChannel: "Canal", tableStatus: "État", tableLatest: "Dernière mesure", initialStartup: "Mise en route initiale", tableValue: "Valeur", tableSamples: "Échantillons", tableQuality: "Qualité", valid: "Valide", suspect: "{count} suspectes",
    webcams: "Webcams QUBIC", webcamsLater: "Vues en direct d’Alto Chorrillos", webcamsTitle: "Webcams de l’observatoire QUBIC", webcamsCopy: "Images en direct relayées de manière sécurisée depuis les trois caméras du site. Les identifiants restent sur le serveur de monitoring.", cameraLive: "En direct", cameraUnavailable: "Caméra temporairement indisponible", camera1: "Caméra 1", camera2: "Caméra 2", camera3: "Caméra 3", enlarge: "Agrandir", captureImage: "Capturer une image", recordVideo: "Enregistrer une vidéo", stopRecording: "Arrêter l’enregistrement", recording: "Enregistrement", recordingLimit: "Enregistrement accéléré · 1 image/s · 30 s maximum", videoUnsupported: "L’enregistrement vidéo n’est pas disponible dans ce navigateur", captureFailed: "Échec de la capture", housekeepingTitle: "Housekeeping", housekeepingCopy: "Choisissez ci-dessous la famille de télémétrie à afficher.", availableChannels: "{count} canaux disponibles", threeSiteCameras: "3 caméras du site", navigation: "Navigation principale", timezone: "Fuseau", displayedCooldown: "Cooldown affiché", currentCooldown: "Cooldown courant", latestGlobal: "Dernier point global", heroTitle: "Vue en direct du cooldown actuel.", heroCopy: "Cette vue utilise le répertoire local du cooldown le plus récent. Chaque source conserve sa chronologie et son état de qualité.",
    metric1K: "Étage 1 K", metric4K: "Filtres 4 K", metricPressure: "Pression cryostat", metricInside: "Température intérieure", snapshotGenerated: "Instantané local généré le {date}", automaticRefresh: "Actualisation automatique · sans recharger la page", phaseColdPartial: "Phase froide — flux partiel", phaseCooldown: "Refroidissement",
    observatoryAlt: "Observatoire QUBIC à Alto Chorrillos", daysBefore: "−2 jours", eventT0: "Événement t₀", daysAfter: "+12 jours",
    "channel.avs47_1_ch1": "Étage 1 K", "channel.avs47_1_ch4": "Tête froide frigo 1 K", "channel.avs47_1_ch6": "Tête froide frigo 300 mK", "channel.temperature06": "Filtres 4 K", "channel.pressure1": "Pression cryostat", "channel.inside_temperature": "Température intérieure", "channel.inside_humidity": "Humidité intérieure",
    "event.beginning-of-data.title": "Début des données", "event.beginning-of-data.copy": "Premier échantillon valide du cooldown courant", "event.pumping.title": "Pression sous 300 mbar", "event.pumping.copy": "Pompage détecté à partir de la pression du cryostat", "event.ptc1-on.title": "PTC 1 ON", "event.ptc1-on.copy": "Le compresseur 1 du tube pulsé fonctionne", "event.ptc2-on.title": "PTC 2 ON", "event.ptc2-on.copy": "Le compresseur 2 du tube pulsé fonctionne", "event.pt1-s2-260k.title": "PT1 S2 CH sous 260 K", "event.pt1-s2-260k.copy": "Le second étage de PT1 entre dans la phase de refroidissement 270–250 K", "event.pt2-s2-260k.title": "PT2 S2 CH sous 260 K", "event.pt2-s2-260k.copy": "Le second étage de PT2 entre dans la phase de refroidissement 270–250 K", "event.pt1-s1-50k.title": "PT1 S1 sous 50 K", "event.pt1-s1-50k.copy": "Le premier étage de PT1 atteint le régime 40 K", "event.pt2-s1-50k.title": "PT2 S1 sous 50 K", "event.pt2-s1-50k.copy": "Le premier étage de PT2 atteint le régime 40 K", "event.pt1-s2-4p5k.title": "PT1 S2 CH sous 4,5 K", "event.pt1-s2-4p5k.copy": "Le second étage de PT1 atteint le régime 4 K", "event.pt2-s2-4p5k.title": "PT2 S2 CH sous 4,5 K", "event.pt2-s2-4p5k.copy": "Le second étage de PT2 atteint le régime 4 K", "event.main-cooldown-complete.title": "Fin du refroidissement principal", "event.main-cooldown-complete.copy": "Les deux seconds étages des PTC sont sous 4,5 K", "event.300mk-fridge-below-3k.title": "Tête froide du frigo 300 mK sous 3 K", "event.300mk-fridge-below-3k.copy": "Premier cyclage du frigo 300 mK", "event.300mk-fridge-below-350mk.title": "Tête froide du frigo 300 mK sous 350 mK", "event.300mk-fridge-below-350mk.copy": "Premier cyclage du frigo 300 mK", "event.1k-fridge-below-3k.title": "Tête froide du frigo 1 K sous 3 K", "event.1k-fridge-below-3k.copy": "Premier cyclage du frigo 1 K", "event.1k-fridge-below-1k.title": "Tête froide du frigo 1 K sous 1 K", "event.1k-fridge-below-1k.copy": "Premier cyclage du frigo 1 K", "event.base-1k.title": "Étage 1 K sous 1,2 K", "event.base-1k.copy": "Candidat automatique — stabilité à confirmer",
  },
  es: {
    "nav.monitoring": "Monitoreo del cooldown", "nav.cycles": "Análisis de ciclos de los frigos", "nav.compare": "Comparación de cooldowns", "nav.sources": "Calidad / Fuentes", "nav.webcams": "Webcams",
    "eyebrow.monitoring": "Telemetría en vivo", "eyebrow.cycles": "Sub-K", "eyebrow.compare": "Análisis", "eyebrow.sources": "Calidad", "eyebrow.webcams": "Observatorio",
    "nav.temperatures": "Temperaturas", "nav.pressure": "Presión del criostato", "nav.touch": "Touch y 1 K", "nav.compressors": "Compresores", "nav.weather": "Tiempo del sitio",
    "eyebrow.temperatures": "Instrumento", "eyebrow.pressure": "Vacío", "eyebrow.touch": "Correlación", "eyebrow.compressors": "Tubos de pulso", "eyebrow.weather": "Alto Chorrillos",
    "nav.overview": "Vista actual", "nav.cold": "Fase fría",
    "eyebrow.overview": "Monitoreo", "eyebrow.cold": "Sub-K",
    "range.all": "Todo", "status.fresh": "Actualizado", "status.delayed": "Demorado", "status.stale": "Desactualizado", "status.missing": "Ausente",
    notAvailable: "No disponible", neverReceived: "nunca recibido", ageMinutes: "hace {count} min", ageHours: "hace {count} h", ageDays: "hace {count} d",
    loading: "Leyendo el instrumento…", loadError: "Los datos locales todavía no están disponibles.", loadErrorHelp: "Actualizá el importador y volvé a cargar esta página.", warningTitle: "Flujo de telemetría parcial", warningBody: "{count} fuente(s) sin datos recientes — las curvas nunca se extienden más allá de su última medición.",
    mainTemperatures: "Temperaturas principales", cryogenicEvolution: "Evolución criogénica", chartCopy: "Agregados por canal. Cada fuente conserva su propia cronología y frescura.", timeWindow: "Ventana temporal", boxZoom: "Zoom rectangular", dragToZoom: "Arrastrá un rectángulo sobre la curva para ampliar ambos ejes", resetZoom: "Restablecer zoom", yAxis: "Eje Y", yMinimum: "Mínimo", yMaximum: "Máximo", autoScale: "Auto", logScale: "Escala log", visibleChannels: "Canales visibles", emptyChart: "No hay canales visibles en este período.", chartHint: "Usá la banda inferior para ampliar y recorrer el tiempo.",
    forecast: "Pronóstico", forecastUnavailable: "Pronóstico temporalmente no disponible", forecastSource: "Pronóstico Open-Meteo · coordenadas QUBIC y altitud 4.869 m", diurnalReference: "Envolvente RMS de 7 días", diurnalReferenceCopy: "Envolvente transparente ± RMS centrada en la curva actual y estimada con los 7 días anteriores", expectedPattern: "Envolvente RMS de 7 días", windRoseTitle: "Velocidad y dirección de llegada del viento", windRoseCopy: "El mapa de colores usa el período de densidad elegido; las muestras recientes se desvanecen con la antigüedad en la ventana temporal mostrada.", windFrom: "Viento desde {direction}", fullCooldownDensity: "Cooldown completo", last24hDensity: "Últimas 24 h", last7dDensity: "Últimos 7 días",
    temperaturesCopy: "Todos los canales de temperatura del instrumento, identificados por nombre humano y archivo fuente.", pressureTitle: "Presión del criostato", pressureCopy: "Vista logarítmica dedicada a la presión de vacío.", touchTitle: "Señal Touch alineada con la etapa de 1 K", touchCopy: "Touch usa el máximo de cada bloque de remuestreo y una normalización logarítmica para conservar las aperturas breves del interruptor térmico mecánico. Ambas señales se normalizan por separado y el gráfico termina 24 horas después del enfriamiento principal.", touchBucketMaximum: "máximo del bloque", fridgeBucketMaximum: "máximo en 10 min", mhsOperations: "Aperturas/cierres MHS detectados", mhsOperationsCopy: "Detección automática durante el enfriamiento principal. Seleccioná una maniobra para examinarla.", mhsOperation: "MHS {count}", mhsPeak: "pico {value}", backToTouchOverview: "Volver a la vista Touch completa", normalizedSignal: "Señal normalizada", compressorTitle: "Compresores de los tubos de pulso", compressorCopy: "Temperaturas, presión de entrada y estado de los dos compresores.", weatherTitle: "Tiempo en Alto Chorrillos", weatherCopy: "Condiciones exteriores e interiores, presión atmosférica, velocidad y dirección del viento.", selectAll: "Seleccionar todo", clearSelection: "Limpiar", online: "En línea", offline: "Fuera de línea",
    automaticMarkers: "Marcadores automáticos", cryogenicTimeline: "Cronología criogénica", timelinePhaseData: "Inicio de los datos", timelinePhaseDataCopy: "Primera muestra válida del cooldown actual", timelinePhasePumping: "Bombeo", timelinePhasePumpingCopy: "Presión del criostato por debajo de 300 mbar", timelinePhaseMain: "Enfriamiento principal", timelinePhaseMainCopy: "Desde el arranque de los PTC hasta las dos segundas etapas por debajo de 4,5 K", timelinePhaseSubK: "Ciclos sub-K", timelinePhaseSubKCopy: "Primeros ciclos de los refrigeradores de 300 mK y 1 K", review: "Revisar", editingSoon: "La edición se agregará próximamente", toDetect: "Por detectar", candidateDetection: "Detección candidata", insufficientData: "Datos insuficientes",
    subKSequence: "Secuencia sub-K", coldTitle: "La fase fría se convierte en un objeto de análisis dedicado.", coldCopy: "Comienza después de confirmar la estabilidad de la etapa de 4 K e incluye los ciclos de 1 K y 300 mK detectados mediante calentadores, MHS y temperaturas.", latest1K: "Última señal de 1 K",
    phase1Title: "Enfriamiento principal", phase1Copy: "El marcador de 260 K fue detectado en el descenso de la etapa de 1 K.", phase2Title: "Estabilidad de 4 K", phase2Copy: "Esperando un flujo reciente de 4 K para confirmar el umbral y su duración.", phase3Title: "Ciclos sub-K", phase3Copy: "La estructura está lista para segmentar y comparar los próximos ciclos.", nextCapability: "Próxima capacidad", cycleReferenceTitle: "Ciclo actual vs referencia", cycleReferenceCopy: "Media, RMS, mediana y percentiles se calcularán después de validar los eventos de inicio y fin de ciclo.", referenceBand: "Referencia ± dispersión",
    comparisonLab: "Laboratorio de comparación", comparisonTitle: "Alinear cooldowns sobre el mismo evento", timeMarker: "Referencia temporal", crossing260: "Cruce descendente a 260 K", stable4K: "Etapa de 4 K estable — pendiente", cycleStart: "Inicio del ciclo sub-K — fase 2", cooldowns: "Cooldowns", current: "Actual", toImport: "Por importar", selectedCooldowns: "{count} cooldown(s) seleccionado(s)", comparisonEmpty: "El cooldown actual está listo. Las curvas históricas se agregarán progresivamente y no se releerán en cada visualización.",
    acquisitionQuality: "Calidad de adquisición", perChannelFreshness: "Frescura por canal", sourceCopy: "La fecha mostrada proviene de la última medición válida de cada archivo.", importedSources: "fuentes importadas", tableChannel: "Canal", tableStatus: "Estado", tableLatest: "Última medición", initialStartup: "Puesta en marcha inicial", tableValue: "Valor", tableSamples: "Muestras", tableQuality: "Calidad", valid: "Válido", suspect: "{count} sospechosas",
    webcams: "Webcams QUBIC", webcamsLater: "Vistas en vivo desde Alto Chorrillos", webcamsTitle: "Webcams del observatorio QUBIC", webcamsCopy: "Imágenes en vivo retransmitidas de forma segura desde las tres cámaras del sitio. Las credenciales quedan en el servidor de monitoreo.", cameraLive: "En vivo", cameraUnavailable: "Cámara temporalmente no disponible", camera1: "Cámara 1", camera2: "Cámara 2", camera3: "Cámara 3", enlarge: "Ampliar", captureImage: "Capturar imagen", recordVideo: "Grabar video", stopRecording: "Detener grabación", recording: "Grabando", recordingLimit: "Grabación acelerada · 1 cuadro/s · máximo 30 s", videoUnsupported: "La grabación de video no está disponible en este navegador", captureFailed: "Falló la captura", housekeepingTitle: "Housekeeping", housekeepingCopy: "Elegí la familia de telemetría que querés ver abajo.", availableChannels: "{count} canales disponibles", threeSiteCameras: "3 cámaras del sitio", navigation: "Navegación principal", timezone: "Zona horaria", displayedCooldown: "Cooldown mostrado", currentCooldown: "Cooldown actual", latestGlobal: "Último punto global", heroTitle: "Vista en vivo del cooldown actual.", heroCopy: "Esta vista usa el directorio local del cooldown más reciente. Cada fuente conserva su cronología y estado de calidad.",
    metric1K: "Etapa de 1 K", metric4K: "Filtros de 4 K", metricPressure: "Presión del criostato", metricInside: "Temperatura interior", snapshotGenerated: "Instantánea local generada el {date}", automaticRefresh: "Actualización automática · sin recargar la página", phaseColdPartial: "Fase fría — flujo parcial", phaseCooldown: "Enfriamiento",
    observatoryAlt: "Observatorio QUBIC en Alto Chorrillos", daysBefore: "−2 días", eventT0: "Evento t₀", daysAfter: "+12 días",
    "channel.avs47_1_ch1": "Etapa de 1 K", "channel.avs47_1_ch4": "Cabezal frío del frigo de 1 K", "channel.avs47_1_ch6": "Cabezal frío del frigo de 300 mK", "channel.temperature06": "Filtros de 4 K", "channel.pressure1": "Presión del criostato", "channel.inside_temperature": "Temperatura interior", "channel.inside_humidity": "Humedad interior",
    "event.beginning-of-data.title": "Inicio de los datos", "event.beginning-of-data.copy": "Primera muestra válida del cooldown actual", "event.pumping.title": "Presión por debajo de 300 mbar", "event.pumping.copy": "Bombeo detectado a partir de la presión del criostato", "event.ptc1-on.title": "PTC 1 ON", "event.ptc1-on.copy": "El compresor 1 del tubo de pulso está funcionando", "event.ptc2-on.title": "PTC 2 ON", "event.ptc2-on.copy": "El compresor 2 del tubo de pulso está funcionando", "event.pt1-s2-260k.title": "PT1 S2 CH por debajo de 260 K", "event.pt1-s2-260k.copy": "La segunda etapa de PT1 entró en la fase de enfriamiento de 270–250 K", "event.pt2-s2-260k.title": "PT2 S2 CH por debajo de 260 K", "event.pt2-s2-260k.copy": "La segunda etapa de PT2 entró en la fase de enfriamiento de 270–250 K", "event.pt1-s1-50k.title": "PT1 S1 por debajo de 50 K", "event.pt1-s1-50k.copy": "La primera etapa de PT1 alcanzó el régimen de 40 K", "event.pt2-s1-50k.title": "PT2 S1 por debajo de 50 K", "event.pt2-s1-50k.copy": "La primera etapa de PT2 alcanzó el régimen de 40 K", "event.pt1-s2-4p5k.title": "PT1 S2 CH por debajo de 4,5 K", "event.pt1-s2-4p5k.copy": "La segunda etapa de PT1 alcanzó el régimen de 4 K", "event.pt2-s2-4p5k.title": "PT2 S2 CH por debajo de 4,5 K", "event.pt2-s2-4p5k.copy": "La segunda etapa de PT2 alcanzó el régimen de 4 K", "event.main-cooldown-complete.title": "Fin de la fase principal de enfriamiento", "event.main-cooldown-complete.copy": "Las dos segundas etapas de los PTC están por debajo de 4,5 K", "event.300mk-fridge-below-3k.title": "Cabezal frío del refrigerador de 300 mK por debajo de 3 K", "event.300mk-fridge-below-3k.copy": "Primer ciclo del refrigerador de 300 mK", "event.300mk-fridge-below-350mk.title": "Cabezal frío del refrigerador de 300 mK por debajo de 350 mK", "event.300mk-fridge-below-350mk.copy": "Primer ciclo del refrigerador de 300 mK", "event.1k-fridge-below-3k.title": "Cabezal frío del refrigerador de 1 K por debajo de 3 K", "event.1k-fridge-below-3k.copy": "Primer ciclo del refrigerador de 1 K", "event.1k-fridge-below-1k.title": "Cabezal frío del refrigerador de 1 K por debajo de 1 K", "event.1k-fridge-below-1k.copy": "Primer ciclo del refrigerador de 1 K", "event.base-1k.title": "Etapa de 1 K por debajo de 1,2 K", "event.base-1k.copy": "Candidato automático — estabilidad por confirmar",
  },
  it: {
    "nav.monitoring": "Monitoraggio del cooldown", "nav.cycles": "Analisi dei cicli dei frigo", "nav.compare": "Confronto dei cooldown", "nav.sources": "Qualità / Sorgenti", "nav.webcams": "Webcam",
    "eyebrow.monitoring": "Telemetria in diretta", "eyebrow.cycles": "Sub-K", "eyebrow.compare": "Analisi", "eyebrow.sources": "Qualità", "eyebrow.webcams": "Osservatorio",
    "nav.temperatures": "Temperature", "nav.pressure": "Pressione criostato", "nav.touch": "Touch e 1 K", "nav.compressors": "Compressori", "nav.weather": "Meteo del sito",
    "eyebrow.temperatures": "Strumento", "eyebrow.pressure": "Vuoto", "eyebrow.touch": "Correlazione", "eyebrow.compressors": "Pulse tube", "eyebrow.weather": "Alto Chorrillos",
    "nav.overview": "Vista attuale", "nav.cold": "Fase fredda",
    "eyebrow.overview": "Monitoraggio", "eyebrow.cold": "Sub-K",
    "range.all": "Tutto", "status.fresh": "Aggiornato", "status.delayed": "In ritardo", "status.stale": "Obsoleto", "status.missing": "Assente",
    notAvailable: "Non disponibile", neverReceived: "mai ricevuto", ageMinutes: "{count} min fa", ageHours: "{count} h fa", ageDays: "{count} g fa",
    loading: "Lettura dello strumento…", loadError: "I dati locali non sono ancora disponibili.", loadErrorHelp: "Aggiorna l’importatore e ricarica questa pagina.", warningTitle: "Flusso di telemetria parziale", warningBody: "{count} sorgente/i senza dati recenti — le curve non vengono mai estese oltre l’ultima misura.",
    mainTemperatures: "Temperature principali", cryogenicEvolution: "Evoluzione criogenica", chartCopy: "Aggregati per canale. Ogni sorgente mantiene la propria cronologia e freschezza.", timeWindow: "Intervallo temporale", boxZoom: "Zoom rettangolare", dragToZoom: "Trascina un rettangolo sulla curva per ingrandire entrambi gli assi", resetZoom: "Reimposta zoom", yAxis: "Asse Y", yMinimum: "Minimo", yMaximum: "Massimo", autoScale: "Auto", logScale: "Scala log", visibleChannels: "Canali visibili", emptyChart: "Nessun canale visibile in questo periodo.", chartHint: "Usa la fascia inferiore per ingrandire e spostarti nel tempo.",
    forecast: "Previsioni", forecastUnavailable: "Previsioni temporaneamente non disponibili", forecastSource: "Previsioni Open-Meteo · coordinate QUBIC e quota 4.869 m", diurnalReference: "Inviluppo RMS di 7 giorni", diurnalReferenceCopy: "Inviluppo trasparente ± RMS centrato sulla curva corrente e stimato sui 7 giorni precedenti", expectedPattern: "Inviluppo RMS di 7 giorni", windRoseTitle: "Velocità e direzione di arrivo del vento", windRoseCopy: "La mappa dei colori usa il periodo di densità scelto; i campioni recenti sfumano con l’età nella finestra temporale visualizzata.", windFrom: "Vento da {direction}", fullCooldownDensity: "Cooldown completo", last24hDensity: "Ultime 24 h", last7dDensity: "Ultimi 7 giorni",
    temperaturesCopy: "Tutti i canali di temperatura dello strumento, con nome umano e file sorgente.", pressureTitle: "Pressione del criostato", pressureCopy: "Vista logaritmica dedicata alla pressione del vuoto.", touchTitle: "Segnale Touch allineato allo stadio 1 K", touchCopy: "Touch usa il massimo di ogni intervallo di ricampionamento e una normalizzazione logaritmica per conservare le brevi aperture dell’interruttore termico meccanico. I due segnali sono normalizzati separatamente e il grafico termina 24 ore dopo la fine del raffreddamento principale.", touchBucketMaximum: "massimo dell’intervallo", fridgeBucketMaximum: "massimo su 10 min", mhsOperations: "Aperture/chiusure MHS rilevate", mhsOperationsCopy: "Rilevamento automatico durante il raffreddamento principale. Seleziona una manovra per esaminarla.", mhsOperation: "MHS {count}", mhsPeak: "picco {value}", backToTouchOverview: "Torna alla vista Touch completa", normalizedSignal: "Segnale normalizzato", compressorTitle: "Compressori dei pulse tube", compressorCopy: "Temperature, pressione d’ingresso e stato dei due compressori.", weatherTitle: "Meteo ad Alto Chorrillos", weatherCopy: "Condizioni esterne e interne, pressione atmosferica, velocità e direzione del vento.", selectAll: "Seleziona tutto", clearSelection: "Cancella", online: "Online", offline: "Offline",
    automaticMarkers: "Riferimenti automatici", cryogenicTimeline: "Cronologia criogenica", timelinePhaseData: "Inizio dei dati", timelinePhaseDataCopy: "Primo campione valido del cooldown corrente", timelinePhasePumping: "Pompaggio", timelinePhasePumpingCopy: "Pressione del criostato sotto 300 mbar", timelinePhaseMain: "Raffreddamento principale", timelinePhaseMainCopy: "Dall’avvio dei PTC ai due secondi stadi sotto 4,5 K", timelinePhaseSubK: "Cicli sub-K", timelinePhaseSubKCopy: "Primi cicli dei refrigeratori da 300 mK e 1 K", review: "Rivedi", editingSoon: "La modifica sarà aggiunta prossimamente", toDetect: "Da rilevare", candidateDetection: "Rilevamento candidato", insufficientData: "Dati insufficienti",
    subKSequence: "Sequenza sub-K", coldTitle: "La fase fredda diventa un oggetto di analisi dedicato.", coldCopy: "Inizia dopo la conferma della stabilità dello stadio 4 K e contiene i cicli 1 K e 300 mK rilevati da riscaldatori, MHS e temperature.", latest1K: "Ultimo segnale 1 K",
    phase1Title: "Raffreddamento principale", phase1Copy: "Il riferimento 260 K è stato rilevato sulla discesa dello stadio 1 K.", phase2Title: "Stabilità 4 K", phase2Copy: "In attesa di un flusso 4 K recente per confermare soglia e durata.", phase3Title: "Cicli sub-K", phase3Copy: "La struttura è pronta per segmentare e confrontare i prossimi cicli.", nextCapability: "Prossima funzione", cycleReferenceTitle: "Ciclo corrente vs riferimento", cycleReferenceCopy: "Media, RMS, mediana e percentili saranno calcolati dopo la convalida degli eventi di inizio e fine ciclo.", referenceBand: "Riferimento ± dispersione",
    comparisonLab: "Laboratorio di confronto", comparisonTitle: "Allineare i cooldown sullo stesso evento", timeMarker: "Riferimento temporale", crossing260: "Passaggio discendente a 260 K", stable4K: "Stadio 4 K stabile — in attesa", cycleStart: "Inizio ciclo sub-K — fase 2", cooldowns: "Cooldown", current: "Corrente", toImport: "Da importare", selectedCooldowns: "{count} cooldown selezionato/i", comparisonEmpty: "Il cooldown corrente è pronto. Le curve storiche saranno aggiunte progressivamente e non verranno rilette a ogni visualizzazione.",
    acquisitionQuality: "Qualità dell’acquisizione", perChannelFreshness: "Aggiornamento per canale", sourceCopy: "La data mostrata proviene dall’ultima misura valida di ciascun file.", importedSources: "sorgenti importate", tableChannel: "Canale", tableStatus: "Stato", tableLatest: "Ultima misura", initialStartup: "Avvio iniziale", tableValue: "Valore", tableSamples: "Campioni", tableQuality: "Qualità", valid: "Valido", suspect: "{count} sospetti",
    webcams: "Webcam QUBIC", webcamsLater: "Viste in diretta da Alto Chorrillos", webcamsTitle: "Webcam dell’osservatorio QUBIC", webcamsCopy: "Immagini in diretta inoltrate in modo sicuro dalle tre telecamere del sito. Le credenziali restano sul server di monitoraggio.", cameraLive: "In diretta", cameraUnavailable: "Telecamera temporaneamente non disponibile", camera1: "Telecamera 1", camera2: "Telecamera 2", camera3: "Telecamera 3", enlarge: "Ingrandisci", captureImage: "Cattura immagine", recordVideo: "Registra video", stopRecording: "Ferma registrazione", recording: "Registrazione", recordingLimit: "Registrazione accelerata · 1 fotogramma/s · massimo 30 s", videoUnsupported: "La registrazione video non è disponibile in questo browser", captureFailed: "Acquisizione non riuscita", housekeepingTitle: "Housekeeping", housekeepingCopy: "Scegli la famiglia di telemetria da visualizzare qui sotto.", availableChannels: "{count} canali disponibili", threeSiteCameras: "3 telecamere del sito", navigation: "Navigazione principale", timezone: "Fuso orario", displayedCooldown: "Cooldown visualizzato", currentCooldown: "Cooldown corrente", latestGlobal: "Ultimo punto globale", heroTitle: "Vista in tempo reale del cooldown corrente.", heroCopy: "Questa vista usa la directory locale del cooldown più recente. Ogni sorgente conserva cronologia e stato di qualità.",
    metric1K: "Stadio 1 K", metric4K: "Filtri 4 K", metricPressure: "Pressione criostato", metricInside: "Temperatura interna", snapshotGenerated: "Istantanea locale generata il {date}", automaticRefresh: "Aggiornamento automatico · senza ricaricare la pagina", phaseColdPartial: "Fase fredda — flusso parziale", phaseCooldown: "Raffreddamento",
    observatoryAlt: "Osservatorio QUBIC ad Alto Chorrillos", daysBefore: "−2 giorni", eventT0: "Evento t₀", daysAfter: "+12 giorni",
    "channel.avs47_1_ch1": "Stadio 1 K", "channel.avs47_1_ch4": "Testa fredda frigo 1 K", "channel.avs47_1_ch6": "Testa fredda frigo 300 mK", "channel.temperature06": "Filtri 4 K", "channel.pressure1": "Pressione criostato", "channel.inside_temperature": "Temperatura interna", "channel.inside_humidity": "Umidità interna",
    "event.beginning-of-data.title": "Inizio dei dati", "event.beginning-of-data.copy": "Primo campione valido del cooldown corrente", "event.pumping.title": "Pressione sotto 300 mbar", "event.pumping.copy": "Pompaggio rilevato dalla pressione del criostato", "event.ptc1-on.title": "PTC 1 ON", "event.ptc1-on.copy": "Il compressore 1 del pulse tube è in funzione", "event.ptc2-on.title": "PTC 2 ON", "event.ptc2-on.copy": "Il compressore 2 del pulse tube è in funzione", "event.pt1-s2-260k.title": "PT1 S2 CH sotto 260 K", "event.pt1-s2-260k.copy": "Il secondo stadio di PT1 è entrato nella fase di raffreddamento 270–250 K", "event.pt2-s2-260k.title": "PT2 S2 CH sotto 260 K", "event.pt2-s2-260k.copy": "Il secondo stadio di PT2 è entrato nella fase di raffreddamento 270–250 K", "event.pt1-s1-50k.title": "PT1 S1 sotto 50 K", "event.pt1-s1-50k.copy": "Il primo stadio di PT1 ha raggiunto il regime di 40 K", "event.pt2-s1-50k.title": "PT2 S1 sotto 50 K", "event.pt2-s1-50k.copy": "Il primo stadio di PT2 ha raggiunto il regime di 40 K", "event.pt1-s2-4p5k.title": "PT1 S2 CH sotto 4,5 K", "event.pt1-s2-4p5k.copy": "Il secondo stadio di PT1 ha raggiunto il regime di 4 K", "event.pt2-s2-4p5k.title": "PT2 S2 CH sotto 4,5 K", "event.pt2-s2-4p5k.copy": "Il secondo stadio di PT2 ha raggiunto il regime di 4 K", "event.main-cooldown-complete.title": "Fine della fase principale di raffreddamento", "event.main-cooldown-complete.copy": "Entrambi i secondi stadi dei PTC sono sotto 4,5 K", "event.300mk-fridge-below-3k.title": "Testa fredda del refrigeratore da 300 mK sotto 3 K", "event.300mk-fridge-below-3k.copy": "Primo ciclo del refrigeratore da 300 mK", "event.300mk-fridge-below-350mk.title": "Testa fredda del refrigeratore da 300 mK sotto 350 mK", "event.300mk-fridge-below-350mk.copy": "Primo ciclo del refrigeratore da 300 mK", "event.1k-fridge-below-3k.title": "Testa fredda del refrigeratore da 1 K sotto 3 K", "event.1k-fridge-below-3k.copy": "Primo ciclo del refrigeratore da 1 K", "event.1k-fridge-below-1k.title": "Testa fredda del refrigeratore da 1 K sotto 1 K", "event.1k-fridge-below-1k.copy": "Primo ciclo del refrigeratore da 1 K", "event.base-1k.title": "Stadio 1 K sotto 1,2 K", "event.base-1k.copy": "Candidato automatico — stabilità da confermare",
  },
};

const timeRangeDurations: Record<TimeRange, number | undefined> = {
  "1h": 3_600_000,
  "2h": 2 * 3_600_000,
  "48h": 48 * 3_600_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: undefined,
};

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const numberFormatterCache = new Map<Language, Intl.NumberFormat>();

function cachedDateFormatter(key: string, locale: string, options: Intl.DateTimeFormatOptions) {
  const existing = dateFormatterCache.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(locale, options);
  dateFormatterCache.set(key, formatter);
  return formatter;
}

function translate(language: Language, key: string, values?: Record<string, string | number>) {
  let text = messages[language][key] ?? messages.en[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function viewLabels(language: Language) {
  return (["monitoring", "cycles", "compare", "sources", "webcams"] as View[]).map((id) => ({
    id,
    label: translate(language, `nav.${id}`),
    eyebrow: translate(language, `eyebrow.${id}`),
  }));
}

function housekeepingLabels(language: Language) {
  return (["temperatures", "pressure", "touch", "compressors", "weather"] as HousekeepingView[]).map((id) => ({
    id,
    label: translate(language, `nav.${id}`),
    eyebrow: translate(language, `eyebrow.${id}`),
  }));
}

function formatRangeLabel(range: TimeRange, language: Language) {
  if (range === "all") return translate(language, "range.all");
  if (range.endsWith("h")) return `${range.slice(0, -1)} h`;
  const suffix = language === "it" ? "g" : language === "fr" ? "j" : "d";
  return `${range.slice(0, -1)} ${suffix}`;
}

function formatDate(timeMs: number | null, language: Language, timeZone: DisplayTimeZone, withTime = true) {
  if (!timeMs) return translate(language, "notAvailable");
  return cachedDateFormatter(`full:${language}:${timeZone}:${withTime}`, locales[language], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" } : {}),
    timeZone,
  }).format(new Date(timeMs));
}

function formatTimelineDate(timeMs: number | null, language: Language, timeZone: DisplayTimeZone) {
  if (!timeMs) return translate(language, "toDetect");
  return cachedDateFormatter(`timeline:${language}:${timeZone}`, locales[language], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(timeMs));
}

function formatCompactDate(timeMs: number, language: Language, visibleSpanMs: number, timeZone: DisplayTimeZone) {
  const options: Intl.DateTimeFormatOptions =
    visibleSpanMs <= 6 * 3_600_000
      ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }
      : visibleSpanMs <= 72 * 3_600_000
        ? { day: "2-digit", hour: "2-digit", timeZoneName: "short" }
        : visibleSpanMs <= 14 * 86_400_000
          ? { day: "2-digit", month: "short", hour: "2-digit", timeZoneName: "short" }
          : { day: "2-digit", month: "short" };

  const formatKind = visibleSpanMs <= 6 * 3_600_000 ? "hours" : visibleSpanMs <= 72 * 3_600_000 ? "days" : visibleSpanMs <= 14 * 86_400_000 ? "fortnight" : "long";
  return cachedDateFormatter(`compact:${language}:${timeZone}:${formatKind}`, locales[language], {
    ...options,
    timeZone,
  }).format(new Date(timeMs));
}

function formatAxisTick(value: number | string, language: Language, logScale = false) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "";
  if (numericValue === 0) return "0";
  const magnitude = Math.abs(numericValue);
  const useScientific = magnitude >= 100_000 || magnitude < 0.001 || (logScale && (magnitude >= 1_000 || magnitude < 0.01));
  if (useScientific) {
    const [rawMantissa, rawExponent] = numericValue.toExponential(logScale ? 1 : 2).split("e");
    const mantissa = rawMantissa.replace(/\.0+$|(?<=\.[0-9])0+$/u, "");
    const exponent = rawExponent.replace(/^\+/u, "").replace("-", "−");
    return `${mantissa}e${exponent}`;
  }
  let formatter = numberFormatterCache.get(language);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locales[language], { maximumSignificantDigits: 3 });
    numberFormatterCache.set(language, formatter);
  }
  return formatter.format(numericValue);
}

function dayBoundaries(domain: [number, number], timeZone: DisplayTimeZone) {
  const [minimum, maximum] = domain;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return [];
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  const dateKey = (timeMs: number) => formatter.format(new Date(timeMs));
  const hour = 3_600_000;
  let previousTime = Math.floor((minimum - 2 * hour) / hour) * hour;
  let previousKey = dateKey(previousTime);
  const boundaries: number[] = [];
  for (let currentTime = previousTime + hour; currentTime <= maximum + 2 * hour; currentTime += hour) {
    const currentKey = dateKey(currentTime);
    if (currentKey !== previousKey) {
      let low = previousTime;
      let high = currentTime;
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const middle = Math.floor((low + high) / 2);
        if (dateKey(middle) === previousKey) low = middle;
        else high = middle;
      }
      if (high >= minimum && high <= maximum) boundaries.push(high);
      previousKey = currentKey;
    }
    previousTime = currentTime;
  }
  const stride = Math.max(1, Math.ceil(boundaries.length / 160));
  return boundaries.filter((_, index) => index % stride === 0);
}

function DayBoundaryLines({ domain, timeZone }: { domain: [number, number]; timeZone: DisplayTimeZone }) {
  const [minimum, maximum] = domain;
  const boundaries = useMemo(() => dayBoundaries([minimum, maximum], timeZone), [minimum, maximum, timeZone]);
  return <>{boundaries.map((timeMs) => <ReferenceLine key={timeMs} x={timeMs} stroke="rgba(162, 180, 204, 0.17)" strokeWidth={1} strokeDasharray="2 7" ifOverflow="extendDomain" />)}</>;
}

function CryogenicPhaseLines({ events, domain, language }: { events: CryogenicEvent[]; domain: [number, number]; language: Language }) {
  const markers = useMemo(() => {
    const byId = new Map(events.map((event) => [event.id, event]));
    const ptcTimes = [byId.get("ptc1-on")?.timeMs, byId.get("ptc2-on")?.timeMs].filter((timeMs): timeMs is number => timeMs !== null && timeMs !== undefined);
    const mainStartMs = ptcTimes.length ? Math.min(...ptcTimes) : null;
    return [
      { id: "data", timeMs: byId.get("beginning-of-data")?.timeMs ?? null, label: translate(language, "timelinePhaseData"), color: "#8fa7ff" },
      { id: "pumping", timeMs: byId.get("pumping")?.timeMs ?? null, label: translate(language, "timelinePhasePumping"), color: "#70d6c7" },
      { id: "main", timeMs: mainStartMs, label: translate(language, "timelinePhaseMain"), color: "#ffb44b" },
      { id: "subk", timeMs: byId.get("main-cooldown-complete")?.timeMs ?? null, label: translate(language, "timelinePhaseSubK"), color: "#e77dff" },
    ].filter((marker): marker is { id: string; timeMs: number; label: string; color: string } => marker.timeMs !== null);
  }, [events, language]);
  const [minimum, maximum] = domain;
  const tolerance = Math.max(1, (maximum - minimum) * 0.006);
  const visible = markers.filter((marker) => marker.timeMs >= minimum && marker.timeMs <= maximum);
  const grouped = visible.reduce<Array<{ id: string; timeMs: number; labels: string[]; color: string }>>((groups, marker) => {
    const previous = groups.at(-1);
    if (previous && marker.timeMs - previous.timeMs <= tolerance) {
      previous.id += `-${marker.id}`;
      previous.labels.push(marker.label);
    } else {
      groups.push({ id: marker.id, timeMs: marker.timeMs, labels: [marker.label], color: marker.color });
    }
    return groups;
  }, []);
  return <>{grouped.map((marker, index) => (
    <ReferenceLine
      key={marker.id}
      x={marker.timeMs}
      stroke={marker.color}
      strokeOpacity={0.72}
      strokeWidth={1.4}
      strokeDasharray="5 5"
      ifOverflow="hidden"
      label={{ value: marker.labels.join(" · "), position: index % 2 ? "insideBottomRight" : "insideTopRight", angle: -90, fill: marker.color, fontSize: 8, fontWeight: 700 }}
    />
  ))}</>;
}

function MhsOperationLines({ events, domain, language }: { events: TouchEvent[]; domain: [number, number]; language: Language }) {
  const [minimum, maximum] = domain;
  const visible = events.filter((event) => event.endMs >= minimum && event.startMs <= maximum);
  return <>{visible.flatMap((event) => {
    const operationNumber = events.indexOf(event) + 1;
    return [
      <ReferenceArea key={`${event.id}-band`} x1={event.startMs} x2={event.endMs} fill="#f87171" fillOpacity={0.14} strokeOpacity={0} ifOverflow="hidden" />,
      <ReferenceLine key={`${event.id}-peak`} x={event.peakMs} stroke="#f87171" strokeWidth={2.6} strokeOpacity={0.95} ifOverflow="hidden" label={{ value: translate(language, "mhsOperation", { count: operationNumber }), position: "insideTopRight", angle: -90, fill: "#f87171", fontSize: 8, fontWeight: 700 }} />,
      <ReferenceLine key={`${event.id}-close`} x={event.endMs} stroke="#70d6c7" strokeWidth={1.8} strokeOpacity={0.9} ifOverflow="hidden" />,
    ];
  })}</>;
}

function makeHoverCurve(data: ChartDatum[], key: string, label: string, unit: string, color: string): HoverCurve {
  return {
    key,
    label,
    unit,
    color,
    points: data.flatMap((row) => row[`${key}__synthetic`] !== 1 && typeof row[key] === "number" && Number.isFinite(row[key]) ? [{ timeMs: row.timeMs, value: row[key] as number }] : []),
  };
}

function preciseHoverValue(curve: HoverCurve, value: number) {
  if (curve.key.includes("wind_direction")) return `${value.toFixed(1)}° · ${directionToCompass(value)}`;
  if (curve.key === "pressure1" || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return `${value.toExponential(5)} ${curve.unit}`.trim();
  return `${value.toPrecision(6)} ${curve.unit}`.trim();
}

function NearestCurveCursor({
  pointerStore,
  left,
  top,
  width,
  height,
  curves,
  xDomain,
  yDomain,
  logScale,
  language,
  timeZone,
}: {
  pointerStore: HoverPointerStore;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  curves: HoverCurve[];
  xDomain: [number, number];
  yDomain: [number, number];
  logScale?: boolean;
  language: Language;
  timeZone: DisplayTimeZone;
}) {
  const pointerCoordinate = useSyncExternalStore(pointerStore.subscribe, pointerStore.getSnapshot, () => null);
  if (!pointerCoordinate || left === undefined || top === undefined || width === undefined || height === undefined || !curves.length || xDomain[1] <= xDomain[0] || yDomain[1] <= yDomain[0]) return null;
  const offset = { left, top, width, height };
  const coordinate = pointerCoordinate;
  const xFraction = Math.min(1, Math.max(0, (coordinate.x - offset.left) / Math.max(1, offset.width)));
  const mouseTimeMs = xDomain[0] + xFraction * (xDomain[1] - xDomain[0]);

  function valueToY(value: number) {
    if (logScale) {
      if (value <= 0 || yDomain[0] <= 0) return null;
      const minimum = Math.log10(yDomain[0]);
      const maximum = Math.log10(yDomain[1]);
      return offset!.top + (1 - (Math.log10(value) - minimum) / Math.max(1e-12, maximum - minimum)) * offset!.height;
    }
    return offset!.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * offset!.height;
  }

  let closest: { curve: HoverCurve; point: { timeMs: number; value: number }; distance: number } | null = null;
  for (const curve of curves) {
    const points = curve.points;
    if (!points.length) continue;
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle].timeMs < mouseTimeMs) low = middle + 1;
      else high = middle;
    }
    const right = points[Math.min(points.length - 1, low)];
    const left = points[Math.max(0, low - 1)];
    const span = right.timeMs - left.timeMs;
    const interpolatedValue = span > 0
      ? left.value + (right.value - left.value) * Math.min(1, Math.max(0, (mouseTimeMs - left.timeMs) / span))
      : left.value;
    const interpolatedY = valueToY(interpolatedValue);
    if (interpolatedY === null) continue;
    const visibleCandidates = [left, right].filter((point) => point.timeMs >= xDomain[0] && point.timeMs <= xDomain[1]);
    if (!visibleCandidates.length) continue;
    const actualPoint = visibleCandidates.reduce((nearest, point) => Math.abs(point.timeMs - mouseTimeMs) < Math.abs(nearest.timeMs - mouseTimeMs) ? point : nearest);
    const distance = Math.abs(interpolatedY - coordinate.y);
    if (!closest || distance < closest.distance) closest = { curve, point: actualPoint, distance };
  }
  if (!closest) return null;

  const pointX = offset.left + (closest.point.timeMs - xDomain[0]) / (xDomain[1] - xDomain[0]) * offset.width;
  const pointY = valueToY(closest.point.value);
  if (pointY === null) return null;
  const tooltipWidth = Math.min(264, Math.max(205, offset.width * 0.55));
  const tooltipHeight = 76;
  const tooltipX = pointX + tooltipWidth + 16 <= offset.left + offset.width ? pointX + 12 : pointX - tooltipWidth - 12;
  const tooltipY = Math.min(offset.top + offset.height - tooltipHeight, Math.max(offset.top, pointY - tooltipHeight / 2));

  return (
    <g className="nearest-curve-cursor" pointerEvents="none">
      <line x1={coordinate.x} x2={coordinate.x} y1={offset.top} y2={offset.top + offset.height} stroke="rgba(185, 201, 222, 0.25)" strokeDasharray="3 5" />
      <circle cx={pointX} cy={pointY} r={7} fill="rgba(6, 12, 22, 0.92)" stroke="rgba(255,255,255,0.72)" strokeWidth={1.5} />
      <circle cx={pointX} cy={pointY} r={4} fill={closest.curve.color} />
      <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight}>
        <div className="nearest-tooltip" style={{ borderColor: closest.curve.color }}>
          <time>{formatDate(closest.point.timeMs, language, timeZone)}</time>
          <strong>{closest.curve.label}</strong>
          <span>{preciseHoverValue(closest.curve, closest.point.value)}</span>
        </div>
      </foreignObject>
    </g>
  );
}

function formatAge(ageMs: number | null, language: Language) {
  if (ageMs === null) return translate(language, "neverReceived");
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return translate(language, "ageMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return translate(language, "ageHours", { count: hours });
  return translate(language, "ageDays", { count: Math.round(hours / 24) });
}

function formatValue(channel?: Channel) {
  if (!channel || channel.latestValue === null) return "—";
  const value = channel.latestValue;
  if (channel.id === "pressure1") return value.toExponential(2);
  if (channel.unit === "raw") return value.toExponential(3);
  if (Math.abs(value) < 10) return value.toFixed(3);
  return value.toFixed(1);
}

function channelName(channel: Channel, language: Language) {
  const key = `channel.${channel.id}`;
  const translated = translate(language, key);
  return translated === key ? channel.label : translated;
}

function mergeChartData(
  channels: Channel[],
  selectedIds: string[],
  range: TimeRange,
  latestGlobalMs: number,
  timelineStartMs?: number,
  zeroBeforeFirstData = false,
  maxPointsPerChannel = 2400,
) {
  const duration = timeRangeDurations[range];
  const minimum = duration ? latestGlobalMs - duration : Number.NEGATIVE_INFINITY;
  const rows = new Map<number, ChartDatum>();
  const selected = new Set(selectedIds);

  // The database already stores range-dependent aggregates, but a long
  // cooldown still contains thousands of points per series. Recharts has to
  // build an SVG path for every one of them whenever a channel is toggled.
  // Keep extrema in each small time bucket so brief cryogenic peaks survive,
  // while bounding the amount of work needed for a redraw.
  const visiblePoints = (points: ChannelPoint[]) => {
    let start = 0;
    if (Number.isFinite(minimum)) {
      let high = points.length;
      while (start < high) {
        const middle = Math.floor((start + high) / 2);
        if (points[middle][0] < minimum) start = middle + 1;
        else high = middle;
      }
    }
    const visible = points.slice(start);
    if (visible.length <= maxPointsPerChannel) return visible;
    const bucketSize = Math.max(1, Math.ceil(visible.length / Math.max(1, Math.floor(maxPointsPerChannel / 2))));
    const retained = new Map<number, ChannelPoint>();
    for (let bucketStart = 0; bucketStart < visible.length; bucketStart += bucketSize) {
      const bucket = visible.slice(bucketStart, bucketStart + bucketSize);
      let minimumPoint = bucket[0];
      let maximumPoint = bucket[0];
      for (const point of bucket) {
        if ((point[2] ?? point[1]) < (minimumPoint[2] ?? minimumPoint[1])) minimumPoint = point;
        if ((point[3] ?? point[1]) > (maximumPoint[3] ?? maximumPoint[1])) maximumPoint = point;
      }
      // Keeping the first and last point makes the decimated line continuous;
      // min/max points preserve narrow fridge and Touch events.
      for (const point of [bucket[0], minimumPoint, maximumPoint, bucket.at(-1)!]) retained.set(point[0], point);
    }
    return [...retained.values()].sort((left, right) => left[0] - right[0]);
  };

  for (const channel of channels) {
    if (!selected.has(channel.id)) continue;
    const firstPoint = channel.points[0];
    const points = visiblePoints(channel.points);
    if (range === "all" && zeroBeforeFirstData && timelineStartMs !== undefined && firstPoint?.[0] > timelineStartMs) {
      for (const timeMs of [timelineStartMs, firstPoint[0] - 1]) {
        const row = rows.get(timeMs) ?? { timeMs };
        row[channel.id] = 0;
        row[`${channel.id}__synthetic`] = 1;
        rows.set(timeMs, row);
      }
    }
    for (const point of points) {
      const row = rows.get(point[0]) ?? { timeMs: point[0] };
      row[channel.id] = point[1];
      rows.set(point[0], row);
    }
  }

  return [...rows.values()].sort((a, b) => a.timeMs - b.timeMs);
}

// Selection changes are common during interactive housekeeping review. Keep a
// small process-local cache so toggling back to a recent combination reuses the
// already merged rows instead of rebuilding every channel from scratch.
const chartDataCache = new Map<string, ChartDatum[]>();

function cachedMergeChartData(
  channels: Channel[],
  selectedIds: string[],
  range: TimeRange,
  latestGlobalMs: number,
  timelineStartMs: number | undefined,
  zeroBeforeFirstData: boolean,
  revision: string,
) {
  const key = `${revision}|${range}|${selectedIds.join(",")}|${timelineStartMs ?? ""}|${zeroBeforeFirstData ? 1 : 0}`;
  const cached = chartDataCache.get(key);
  if (cached) return cached;
  const next = mergeChartData(
    channels,
    selectedIds,
    range,
    latestGlobalMs,
    timelineStartMs,
    zeroBeforeFirstData,
    chartPointBudgets[range],
  );
  chartDataCache.set(key, next);
  if (chartDataCache.size > 32) {
    const oldest = chartDataCache.keys().next().value;
    if (oldest !== undefined) chartDataCache.delete(oldest);
  }
  return next;
}

function StatusDot({ status }: { status: ChannelStatus }) {
  return <span className={`status-dot status-${status}`} aria-hidden="true" />;
}

function LoadingState({ language }: { language: Language }) {
  return (
    <main className="loading-state" role="status">
      <img className="brand-logo" src="/logo-qubic.png" alt="QUBIC" />
      <p className="eyebrow">QUBIC Monitoring</p>
      <h1>{translate(language, "loading")}</h1>
    </main>
  );
}

function SourceWarning({ snapshot, language }: { snapshot: MonitoringSnapshot; language: Language }) {
  const staleCount = snapshot.sourceHealth.stale + snapshot.sourceHealth.missing;
  if (!staleCount) return null;
  return (
    <div className="source-warning" role="status">
      <span className="warning-icon">!</span>
      <div>
        <strong>{translate(language, "warningTitle")}</strong>
        <span>{translate(language, "warningBody", { count: staleCount })}</span>
      </div>
    </div>
  );
}

function MetricCard({
  channel,
  label,
  language,
  tone = "default",
}: {
  channel?: Channel;
  label: string;
  language: Language;
  tone?: "default" | "accent";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-heading">
        <span>{label}</span>
        <span className={`status-badge badge-${channel?.status ?? "missing"}`}>
          <StatusDot status={channel?.status ?? "missing"} />
          {translate(language, `status.${channel?.status ?? "missing"}`)}
        </span>
      </div>
      <div className="metric-value">
        {formatValue(channel)} <small>{channel?.unit ?? ""}</small>
      </div>
      <p>{formatAge(channel?.ageMs ?? null, language)}</p>
    </article>
  );
}

const rangeIds: TimeRange[] = ["1h", "2h", "48h", "7d", "30d", "all"];
const chartPointBudgets: Record<TimeRange, number> = {
  "1h": 1200,
  "2h": 1200,
  "48h": 1800,
  "7d": 2200,
  "30d": 2400,
  all: 2400,
};

function RangeSelector({ range, setRange, language }: { range: TimeRange; setRange: (range: TimeRange) => void; language: Language }) {
  return (
    <div className="segmented" aria-label={translate(language, "timeWindow")}>
      {rangeIds.map((rangeId) => (
        <button type="button" key={rangeId} className={range === rangeId ? "active" : ""} onClick={() => setRange(rangeId)}>
          {formatRangeLabel(rangeId, language)}
        </button>
      ))}
    </div>
  );
}

function chartExtent(data: ChartDatum[], keys: string[], logScale = false, xDomain?: [number, number]) {
  const values: number[] = [];
  for (const row of data) {
    if (xDomain && (row.timeMs < xDomain[0] || row.timeMs > xDomain[1])) continue;
    for (const key of keys) {
      const value = row[key];
      if (Array.isArray(value)) {
        for (const part of value) if (Number.isFinite(part) && (!logScale || part > 0)) values.push(part);
      } else if (Number.isFinite(value) && (!logScale || value > 0)) {
        values.push(value);
      }
    }
  }
  if (!values.length) return logScale ? [1, 10] as [number, number] : [0, 1] as [number, number];
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    if (logScale) {
      minimum /= 1.1;
      maximum *= 1.1;
    } else {
      const padding = Math.abs(minimum || 1) * 0.08;
      minimum -= padding;
      maximum += padding;
    }
  } else if (logScale) {
    const logPadding = (Math.log10(maximum) - Math.log10(minimum)) * 0.04;
    minimum = 10 ** (Math.log10(minimum) - logPadding);
    maximum = 10 ** (Math.log10(maximum) + logPadding);
  } else {
    const padding = (maximum - minimum) * 0.06;
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum] as [number, number];
}

function zoomFromSelection(
  selection: ZoomSelection,
  range: TimeRange,
  xDomain: [number, number],
  yDomain: [number, number],
  logScale = false,
): ZoomDomain {
  const xSpan = xDomain[1] - xDomain[0];
  const xMin = xDomain[0] + selection.left * xSpan;
  const xMax = xDomain[0] + selection.right * xSpan;
  let yMin: number;
  let yMax: number;
  if (logScale) {
    const logMin = Math.log10(Math.max(yDomain[0], 1e-12));
    const logMax = Math.log10(Math.max(yDomain[1], 1e-11));
    yMax = 10 ** (logMax - selection.top * (logMax - logMin));
    yMin = 10 ** (logMax - selection.bottom * (logMax - logMin));
  } else {
    const ySpan = yDomain[1] - yDomain[0];
    yMax = yDomain[1] - selection.top * ySpan;
    yMin = yDomain[1] - selection.bottom * ySpan;
  }
  return { xMin, xMax, yMin, yMax, range };
}

function BoxZoomOverlay({ enabled, onZoom, language }: { enabled: boolean; onZoom: (selection: ZoomSelection) => void; language: Language }) {
  const [drag, setDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  function coordinates(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
      width: bounds.width,
      height: bounds.height,
    };
  }

  function finish(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const point = coordinates(event);
    const leftPx = Math.min(drag.startX, point.x);
    const rightPx = Math.max(drag.startX, point.x);
    const topPx = Math.min(drag.startY, point.y);
    const bottomPx = Math.max(drag.startY, point.y);
    if (rightPx - leftPx >= 10 && bottomPx - topPx >= 10) {
      onZoom({ left: leftPx / point.width, right: rightPx / point.width, top: topPx / point.height, bottom: bottomPx / point.height });
    }
    setDrag(null);
  }

  return (
    <div
      className={`box-zoom-overlay ${enabled ? "enabled" : ""}`}
      title={translate(language, "dragToZoom")}
      onPointerDown={(event) => {
        if (!enabled) return;
        const point = coordinates(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const point = coordinates(event);
        setDrag((current) => current ? { ...current, endX: point.x, endY: point.y } : current);
      }}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      {drag ? (
        <span className="box-zoom-selection" style={{ left: Math.min(drag.startX, drag.endX), top: Math.min(drag.startY, drag.endY), width: Math.abs(drag.endX - drag.startX), height: Math.abs(drag.endY - drag.startY) }} />
      ) : null}
    </div>
  );
}

function ZoomControls({ enabled, setEnabled, hasZoom, reset, language }: { enabled: boolean; setEnabled: (value: boolean) => void; hasZoom: boolean; reset: () => void; language: Language }) {
  return (
    <div className="zoom-controls">
      <button type="button" className={`scale-toggle ${enabled ? "active" : ""}`} onClick={() => setEnabled(!enabled)} aria-pressed={enabled} title={translate(language, "dragToZoom")}>
        □ {translate(language, "boxZoom")}
      </button>
      {hasZoom ? <button type="button" className="scale-toggle" onClick={reset}>{translate(language, "resetZoom")}</button> : null}
    </div>
  );
}

function HousekeepingSelector({
  snapshot,
  selected,
  setSelected,
  language,
}: {
  snapshot: MonitoringSnapshot;
  selected: HousekeepingView;
  setSelected: (view: HousekeepingView) => void;
  language: Language;
}) {
  const temperatures = snapshot.channels.filter((channel) => channel.category === "temperature");
  const availableTemperatures = temperatures.filter((channel) => channel.status !== "missing").length;
  const pressure = snapshot.channels.find((channel) => channel.id === "pressure1");
  const touch = snapshot.channels.find((channel) => channel.id === "avs47_1_ch0");
  const compressorOnline = [1, 2].filter((number) => snapshot.channels.find((channel) => channel.id === `compressor${number}_online`)?.latestValue === 1).length;
  const weatherAvailable = snapshot.channels.filter((channel) => channel.category === "weather" && channel.status !== "missing").length;
  const detail: Record<HousekeepingView, string> = {
    temperatures: translate(language, "availableChannels", { count: `${availableTemperatures}/${temperatures.length}` }),
    pressure: `${formatValue(pressure)} ${pressure?.unit ?? ""}`,
    touch: `${formatValue(touch)} ${touch?.unit ?? ""}`,
    compressors: `${compressorOnline}/2 ${translate(language, "online").toLowerCase()}`,
    weather: translate(language, "availableChannels", { count: weatherAvailable }),
  };
  const glyph: Record<HousekeepingView, string> = {
    temperatures: "T",
    pressure: "P",
    touch: "T↔",
    compressors: "C",
    weather: "W",
  };

  return (
    <section className="panel housekeeping-selector">
      <div className="housekeeping-heading">
        <div>
          <p className="eyebrow">{translate(language, "eyebrow.monitoring")}</p>
          <h2>{translate(language, "housekeepingTitle")}</h2>
          <p>{translate(language, "housekeepingCopy")}</p>
        </div>
      </div>
      <div className="housekeeping-grid">
        {housekeepingLabels(language).map((item) => (
          <button type="button" key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}>
            <span className="housekeeping-glyph">{glyph[item.id]}</span>
            <span className="housekeeping-copy">
              <small>{item.eyebrow}</small>
              <strong>{item.label}</strong>
              <span>{detail[item.id]}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TelemetryChart({
  channels,
  events,
  latestGlobalMs,
  language,
  timeZone,
  eyebrow,
  title,
  copy,
  defaultIds,
  initialRange = "all",
  allowLogScale = false,
  initialLogScale = false,
  hardYMinimum,
  timelineStartMs,
  zeroBeforeFirstData = false,
}: {
  channels: Channel[];
  events: CryogenicEvent[];
  latestGlobalMs: number;
  language: Language;
  timeZone: DisplayTimeZone;
  eyebrow: string;
  title: string;
  copy: string;
  defaultIds: string[];
  initialRange?: TimeRange;
  allowLogScale?: boolean;
  initialLogScale?: boolean;
  hardYMinimum?: number;
  timelineStartMs?: number;
  zeroBeforeFirstData?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultIds);
  const [range, setRange] = useState<TimeRange>(initialRange);
  const [logScale, setLogScale] = useState(initialLogScale);
  const [zoomMode, setZoomMode] = useState(false);
  const [zoom, setZoom] = useState<ZoomDomain | null>(null);
  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const hoverPointer = useMemo(() => createHoverPointerStore(), []);
  const dataRevision = useMemo(
    () => `${latestGlobalMs}|${channels.map((channel) => `${channel.id}:${channel.latestMs}:${channel.points.length}`).join("|")}`,
    [channels, latestGlobalMs],
  );
  const data = useMemo(
    () => cachedMergeChartData(channels, selectedIds, range, latestGlobalMs, timelineStartMs, zeroBeforeFirstData, dataRevision),
    [channels, dataRevision, latestGlobalMs, range, selectedIds, timelineStartMs, zeroBeforeFirstData],
  );
  const units = Array.from(new Set(channels.filter((channel) => selectedIds.includes(channel.id)).map((channel) => channel.unit)));
  const axisUnit = units.length === 1 ? ` ${units[0]}` : "";
  const activeZoom = zoom?.range === range ? zoom : null;
  const brushedData = brushRange ? data.slice(brushRange.startIndex, brushRange.endIndex + 1) : data;
  const currentXDomain: [number, number] = activeZoom
    ? [activeZoom.xMin, activeZoom.xMax]
    : [brushedData[0]?.timeMs ?? data[0]?.timeMs ?? 0, brushedData.at(-1)?.timeMs ?? data.at(-1)?.timeMs ?? 1];
  const computedYDomain: [number, number] = activeZoom
    ? [activeZoom.yMin, activeZoom.yMax]
    : chartExtent(data, selectedIds, logScale, currentXDomain);
  const currentYDomain: [number, number] = hardYMinimum !== undefined && !logScale
    ? [Math.max(hardYMinimum, computedYDomain[0]), Math.max(hardYMinimum + Number.EPSILON, computedYDomain[1])]
    : computedYDomain;
  const visibleSpanMs = Math.max(1, currentXDomain[1] - currentXDomain[0]);
  const fullSpanMs = Math.max(1, (data.at(-1)?.timeMs ?? 1) - (data[0]?.timeMs ?? 0));
  const hoverCurves = useMemo(() => selectedIds.flatMap((id) => {
    const channel = channels.find((item) => item.id === id);
    const label = channel?.aggregation === "bucket_max_10m"
      ? `${channelName(channel, language)} · ${translate(language, "fridgeBucketMaximum")}`
      : channel ? channelName(channel, language) : "";
    return channel ? [makeHoverCurve(data, id, label, channel.unit, channel.color)] : [];
  }), [channels, data, language, selectedIds]);

  function toggleChannel(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setZoom(null);
    setBrushRange(null);
  }

  return (
    <section className="panel chart-panel telemetry-panel">
      <div className="panel-heading chart-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="panel-copy">{copy}</p>
        </div>
      </div>

      <div className="selector-tools">
        <span>{translate(language, "visibleChannels")}</span>
        <button type="button" onClick={() => { setSelectedIds(channels.map((channel) => channel.id)); setZoom(null); setBrushRange(null); }}>{translate(language, "selectAll")}</button>
        <button type="button" onClick={() => { setSelectedIds([]); setZoom(null); setBrushRange(null); }}>{translate(language, "clearSelection")}</button>
      </div>
      <div className="channel-selector detailed-selector" aria-label={translate(language, "visibleChannels")}>
        {channels.map((channel) => {
          const selected = selectedIds.includes(channel.id);
          return (
            <button type="button" key={channel.id} className={`channel-chip ${selected ? "selected" : ""}`} onClick={() => toggleChannel(channel.id)} aria-pressed={selected}>
              <span className="channel-swatch" style={{ backgroundColor: channel.color }} />
              <span className="channel-chip-copy"><strong>{channelName(channel, language)}</strong><small>{channel.sourceName}{channel.aggregation === "bucket_max_10m" ? ` · ${translate(language, "fridgeBucketMaximum")}` : ""}</small></span>
              <StatusDot status={channel.status} />
            </button>
          );
        })}
      </div>

      <div className="chart-wrap">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 18, right: 20, left: 6, bottom: 6 }} onMouseMove={(state) => hoverPointer.set(state.activeCoordinate ?? null)} onMouseLeave={() => hoverPointer.set(null)}>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
              <XAxis dataKey="timeMs" type="number" scale="time" domain={activeZoom ? [activeZoom.xMin, activeZoom.xMax] : ["dataMin", "dataMax"]} allowDataOverflow={Boolean(activeZoom)} tickFormatter={(value) => formatCompactDate(value, language, visibleSpanMs, timeZone)} stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 11 }} minTickGap={42} />
              <YAxis type="number" scale={logScale ? "log" : "auto"} domain={currentYDomain} allowDataOverflow tickFormatter={(value) => formatAxisTick(value, language, logScale)} stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 11 }} width={66} unit={axisUnit} />
              <DayBoundaryLines domain={currentXDomain} timeZone={timeZone} />
              <CryogenicPhaseLines events={events} domain={currentXDomain} language={language} />
              <Tooltip isAnimationActive={false} content={() => null} cursor={<NearestCurveCursor pointerStore={hoverPointer} curves={hoverCurves} xDomain={currentXDomain} yDomain={currentYDomain} logScale={logScale} language={language} timeZone={timeZone} />} />
              {channels.map((channel) => selectedIds.includes(channel.id) ? (
                <Line key={channel.id} type={channel.aggregation === "bucket_max_10m" ? "linear" : "monotone"} dataKey={channel.id} name={channel.id} stroke={channel.color} strokeWidth={channel.id === "avs47_1_ch1" || channel.id.endsWith("_pin") ? 2.6 : 1.7} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              ) : null)}
              <Brush dataKey="timeMs" height={28} stroke="#4a607d" fill="#0d1828" travellerWidth={8} tickFormatter={(value) => formatCompactDate(value, language, fullSpanMs, timeZone)} onChange={(selection) => {
                if (typeof selection.startIndex === "number" && typeof selection.endIndex === "number") setBrushRange({ startIndex: selection.startIndex, endIndex: selection.endIndex });
              }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="empty-chart">{translate(language, "emptyChart")}</div>}
        {data.length ? <BoxZoomOverlay enabled={zoomMode} language={language} onZoom={(selection) => { setZoom(zoomFromSelection(selection, range, currentXDomain, currentYDomain, logScale)); setZoomMode(false); }} /> : null}
      </div>
      <div className="plot-control-bar">
        <div className="chart-controls">
          <RangeSelector range={range} setRange={(nextRange) => { setRange(nextRange); setZoom(null); setBrushRange(null); }} language={language} />
          <ZoomControls enabled={zoomMode} setEnabled={setZoomMode} hasZoom={Boolean(activeZoom)} reset={() => setZoom(null)} language={language} />
          {allowLogScale ? (
            <button type="button" className={`scale-toggle ${logScale ? "active" : ""}`} onClick={() => { setLogScale((value) => !value); setZoom(null); }} aria-pressed={logScale}>
              {translate(language, "logScale")}
            </button>
          ) : null}
        </div>
        <p className="chart-hint">{translate(language, "chartHint")}</p>
      </div>
    </section>
  );
}

function TemperatureChart({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const channels = snapshot.channels.filter((channel) => channel.category === "temperature");
  const defaults = ["avs47_1_ch1", "avs47_1_ch2", "avs47_1_ch4", "avs47_1_ch6", "avs47_2_ch0", "avs47_2_ch1", "temperature01", "temperature06"];
  return <TelemetryChart channels={channels} events={snapshot.events} latestGlobalMs={snapshot.latestGlobalMs} language={language} timeZone={timeZone} eyebrow={translate(language, "mainTemperatures")} title={translate(language, "cryogenicEvolution")} copy={translate(language, "temperaturesCopy")} defaultIds={defaults} allowLogScale hardYMinimum={0} />;
}

function PressurePanel({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const pressure = snapshot.channels.find((channel) => channel.id === "pressure1");
  const channels = snapshot.channels.filter((channel) => channel.category === "pressure");
  return (
    <div className="view-stack">
      <section className="metrics-grid metrics-single"><MetricCard channel={pressure} label={translate(language, "pressureTitle")} language={language} tone="accent" /></section>
      <TelemetryChart channels={channels} events={snapshot.events} latestGlobalMs={snapshot.latestGlobalMs} language={language} timeZone={timeZone} eyebrow={translate(language, "eyebrow.pressure")} title={translate(language, "pressureTitle")} copy={translate(language, "pressureCopy")} defaultIds={["pressure1"]} initialLogScale allowLogScale />
    </div>
  );
}

function TouchPanel({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const [range, setRange] = useState<TimeRange>("all");
  const [zoomMode, setZoomMode] = useState(false);
  const [zoom, setZoom] = useState<ZoomDomain | null>(null);
  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const hoverPointer = useMemo(() => createHoverPointerStore(), []);
  const touch = snapshot.channels.find((channel) => channel.id === "avs47_1_ch0");
  const oneK = snapshot.channels.find((channel) => channel.id === "avs47_1_ch1");
  const touchEvents = snapshot.touchEvents ?? [];
  const mainCooldownEndMs = snapshot.events.find((event) => event.id === "main-cooldown-complete")?.timeMs ?? null;
  const touchDisplayEndMs = Math.min(snapshot.latestGlobalMs, mainCooldownEndMs !== null ? mainCooldownEndMs + 86_400_000 : snapshot.latestGlobalMs);
  const channels = useMemo(() => [touch, oneK].filter(Boolean) as Channel[], [touch, oneK]);
  const activeZoom = zoom?.range === range ? zoom : null;
  const data = useMemo(() => {
    const duration = timeRangeDurations[range];
    const minimum = activeZoom?.xMin ?? (duration ? touchDisplayEndMs - duration : Number.NEGATIVE_INFINITY);
    const maximum = activeZoom?.xMax ?? touchDisplayEndMs;
    const rows = new Map<number, ChartDatum>();
    for (const channel of channels) {
      const points = channel.points
        .filter((point) => point[0] >= minimum && point[0] <= maximum && Number.isFinite(point[1]) && (channel.id !== "avs47_1_ch0" || point[1] > 0))
        .map((point) => [point[0], channel.id === "avs47_1_ch0" ? Math.log10(point[1]) : point[1]] as ChannelPoint);
      const values = points.map((point) => point[1]);
      const low = Math.min(...values);
      const high = Math.max(...values);
      const span = high - low || 1;
      for (const point of points) {
        const row = rows.get(point[0]) ?? { timeMs: point[0] };
        row[channel.id] = (point[1] - low) / span;
        rows.set(point[0], row);
      }
    }
    return [...rows.values()].sort((a, b) => a.timeMs - b.timeMs);
  }, [activeZoom, channels, range, touchDisplayEndMs]);
  const brushedData = brushRange ? data.slice(brushRange.startIndex, brushRange.endIndex + 1) : data;
  const currentXDomain: [number, number] = activeZoom
    ? [activeZoom.xMin, activeZoom.xMax]
    : [brushedData[0]?.timeMs ?? data[0]?.timeMs ?? 0, brushedData.at(-1)?.timeMs ?? data.at(-1)?.timeMs ?? 1];
  const currentYDomain: [number, number] = activeZoom ? [activeZoom.yMin, activeZoom.yMax] : [0, 1];
  const visibleSpanMs = Math.max(1, currentXDomain[1] - currentXDomain[0]);
  const fullSpanMs = Math.max(1, (data.at(-1)?.timeMs ?? 1) - (data[0]?.timeMs ?? 0));
  const hoverCurves = useMemo(() => channels.map((channel) => makeHoverCurve(
    data,
    channel.id,
    channel.id === "avs47_1_ch0" ? `${channelName(channel, language)} · ${translate(language, "touchBucketMaximum")}` : channelName(channel, language),
    "",
    channel.color,
  )), [channels, data, language]);

  function focusMhsOperation(event: TouchEvent) {
    const halfWindow = Math.max(6 * 3_600_000, (event.endMs - event.startMs) * 8);
    setRange("all");
    setBrushRange(null);
    setZoom({ xMin: event.peakMs - halfWindow, xMax: event.peakMs + halfWindow, yMin: 0, yMax: 1, range: "all" });
  }

  function resetTouchView() {
    setRange("all");
    setZoom(null);
    setBrushRange(null);
    setZoomMode(false);
  }

  return (
    <section className="panel chart-panel telemetry-panel">
      <div className="panel-heading chart-heading">
        <div><p className="eyebrow">{translate(language, "eyebrow.touch")}</p><h2>{translate(language, "touchTitle")}</h2><p className="panel-copy">{translate(language, "touchCopy")}</p></div>
      </div>
      <div className="touch-legend">
        {channels.map((channel) => <div key={channel.id}><span style={{ background: channel.color }} /><strong>{channel.id === "avs47_1_ch0" ? `${channelName(channel, language)} · ${translate(language, "touchBucketMaximum")}` : channelName(channel, language)}</strong><small>{channel.sourceName}</small><StatusDot status={channel.status} /></div>)}
      </div>
      <div className="mhs-operations">
        <div className="mhs-operations-heading">
          <strong>{translate(language, "mhsOperations")} · {touchEvents.length}</strong>
          <small>{translate(language, "mhsOperationsCopy")}</small>
          {activeZoom ? <button type="button" className="mhs-overview-button" onClick={resetTouchView}>{translate(language, "backToTouchOverview")}</button> : null}
        </div>
        <div className="mhs-operation-list">
          {touchEvents.map((event, index) => (
            <button type="button" key={event.id} onClick={() => focusMhsOperation(event)}>
              <strong>{translate(language, "mhsOperation", { count: index + 1 })}</strong>
              <span>{formatTimelineDate(event.peakMs, language, timeZone)}</span>
              <small>{translate(language, "mhsPeak", { value: event.peakValue.toPrecision(4) })} · +{Math.round((event.peakRatio - 1) * 100)}%</small>
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        {data.length ? <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 20, left: 6, bottom: 6 }} onMouseMove={(state) => hoverPointer.set(state.activeCoordinate ?? null)} onMouseLeave={() => hoverPointer.set(null)}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="timeMs" type="number" scale="time" domain={activeZoom ? [activeZoom.xMin, activeZoom.xMax] : ["dataMin", "dataMax"]} allowDataOverflow={Boolean(activeZoom)} tickFormatter={(value) => formatCompactDate(value, language, visibleSpanMs, timeZone)} stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 11 }} />
            <YAxis domain={activeZoom ? [activeZoom.yMin, activeZoom.yMax] : [0, 1]} allowDataOverflow={Boolean(activeZoom)} tickFormatter={(value) => formatAxisTick(value, language)} width={58} unit="" stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 11 }} />
            <DayBoundaryLines domain={currentXDomain} timeZone={timeZone} />
            <CryogenicPhaseLines events={snapshot.events} domain={currentXDomain} language={language} />
            <MhsOperationLines events={touchEvents} domain={currentXDomain} language={language} />
            <Tooltip isAnimationActive={false} content={() => null} cursor={<NearestCurveCursor pointerStore={hoverPointer} curves={hoverCurves} xDomain={currentXDomain} yDomain={currentYDomain} language={language} timeZone={timeZone} />} />
            {channels.map((channel) => <Line key={channel.id} type="monotone" dataKey={channel.id} name={channel.id} stroke={channel.color} strokeWidth={channel.id === "avs47_1_ch0" ? 2.2 : 2.8} dot={false} activeDot={false} connectNulls isAnimationActive={false} />)}
            <Brush dataKey="timeMs" height={28} stroke="#4a607d" fill="#0d1828" travellerWidth={8} tickFormatter={(value) => formatCompactDate(value, language, fullSpanMs, timeZone)} onChange={(selection) => {
              if (typeof selection.startIndex === "number" && typeof selection.endIndex === "number") setBrushRange({ startIndex: selection.startIndex, endIndex: selection.endIndex });
            }} />
          </LineChart>
        </ResponsiveContainer> : <div className="empty-chart">{translate(language, "emptyChart")}</div>}
        {data.length ? <BoxZoomOverlay enabled={zoomMode} language={language} onZoom={(selection) => { setZoom(zoomFromSelection(selection, range, currentXDomain, currentYDomain)); setZoomMode(false); }} /> : null}
      </div>
      <div className="plot-control-bar">
        <div className="chart-controls">
          <RangeSelector range={range} setRange={(nextRange) => { setRange(nextRange); setZoom(null); setBrushRange(null); }} language={language} />
          <ZoomControls enabled={zoomMode} setEnabled={setZoomMode} hasZoom={Boolean(activeZoom)} reset={resetTouchView} language={language} />
        </div>
        <p className="chart-hint">{translate(language, "normalizedSignal")} · 0 → 1</p>
      </div>
    </section>
  );
}

function CompressorStatusCard({ number, snapshot, language, timeZone }: { number: 1 | 2; snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const online = snapshot.channels.find((channel) => channel.id === `compressor${number}_online`);
  const helium = snapshot.channels.find((channel) => channel.id === `compressor${number}_the`);
  const inletTemperature = snapshot.channels.find((channel) => channel.id === `compressor${number}_tin`);
  const outletTemperature = snapshot.channels.find((channel) => channel.id === `compressor${number}_tout`);
  const pressure = snapshot.channels.find((channel) => channel.id === `compressor${number}_pin`);
  const initialStartup = snapshot.events.find((event) => event.id === `ptc${number}-on`)?.timeMs ?? null;
  const isOnline = online?.latestValue === 1;
  return (
    <article className={`compressor-status ${isOnline ? "is-online" : "is-offline"}`}>
      <div><span className="status-dot" /><p className="eyebrow">Compressor {number}</p><h3>{translate(language, isOnline ? "online" : "offline")}</h3></div>
      <dl><div><dt>THe</dt><dd>{formatValue(helium)} {helium?.unit}</dd></div><div><dt>TIn</dt><dd>{formatValue(inletTemperature)} {inletTemperature?.unit}</dd></div><div><dt>TOut</dt><dd>{formatValue(outletTemperature)} {outletTemperature?.unit}</dd></div><div><dt>PIn</dt><dd>{formatValue(pressure)} {pressure?.unit}</dd></div><div><dt>{translate(language, "tableLatest")}</dt><dd>{formatAge(online?.ageMs ?? null, language)}</dd></div><div className="compressor-startup"><dt>{translate(language, "initialStartup")}</dt><dd>{formatDate(initialStartup, language, timeZone)}</dd></div></dl>
    </article>
  );
}

function CompressorsPanel({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const channels = snapshot.channels.filter((channel) => channel.category === "compressor" && !channel.id.endsWith("_hours"));
  const temperatureStartMs = Math.min(...snapshot.channels
    .filter((channel) => channel.category === "temperature" && channel.firstMs > 0)
    .map((channel) => channel.firstMs));
  return (
    <div className="view-stack">
      <section className="compressor-grid"><CompressorStatusCard number={1} snapshot={snapshot} language={language} timeZone={timeZone} /><CompressorStatusCard number={2} snapshot={snapshot} language={language} timeZone={timeZone} /></section>
      <TelemetryChart channels={channels} events={snapshot.events} latestGlobalMs={snapshot.latestGlobalMs} language={language} timeZone={timeZone} eyebrow={translate(language, "eyebrow.compressors")} title={translate(language, "compressorTitle")} copy={translate(language, "compressorCopy")} defaultIds={channels.map((channel) => channel.id)} initialRange="48h" timelineStartMs={Number.isFinite(temperatureStartMs) ? temperatureStartMs : undefined} zeroBeforeFirstData />
    </div>
  );
}

const forecastFields: Record<string, keyof Omit<ForecastPoint, "timeMs">> = {
  site_temperature: "temperature",
  site_humidity: "humidity",
  site_pressure: "pressure",
  site_wind_speed: "windSpeed",
  site_wind_direction: "windDirection",
};

function forecastHorizon(range: TimeRange) {
  if (range === "1h") return 3 * 3_600_000;
  if (range === "2h") return 6 * 3_600_000;
  if (range === "48h") return 48 * 3_600_000;
  if (range === "7d") return 7 * 86_400_000;
  return 16 * 86_400_000;
}

function forecastBiases(channels: Channel[], forecast: WeatherForecast | null, latestGlobalMs: number) {
  const biases = new Map<string, number>();
  if (!forecast?.points.length) return biases;
  const anchor = forecast.points.reduce((closest, point) => Math.abs(point.timeMs - latestGlobalMs) < Math.abs(closest.timeMs - latestGlobalMs) ? point : closest);
  for (const channel of channels) {
    if (!["site_temperature", "site_humidity", "site_pressure"].includes(channel.id) || channel.latestValue === null) continue;
    const field = forecastFields[channel.id];
    const modelValue = field ? anchor[field] : null;
    if (typeof modelValue === "number") biases.set(channel.id, channel.latestValue - modelValue);
  }
  return biases;
}

function directionToCompass(direction: number) {
  const labels = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return labels[Math.round(((direction % 360) + 360) % 360 / 22.5) % 16];
}

function weatherValue(channel?: Channel) {
  if (!channel || channel.latestValue === null) return "—";
  if (channel.id === "site_wind_direction") return `${Math.round(channel.latestValue)}° · ${directionToCompass(channel.latestValue)}`;
  return `${formatValue(channel)} ${channel.unit}`;
}

function argentinaHour(timeMs: number) {
  return new Date(timeMs - 3 * 3_600_000).getUTCHours();
}

function rmsEnvelope(channel: Channel, minimumTimeMs: number, latestGlobalMs: number) {
  const points = channel.points.filter((point) => Number.isFinite(point[1])).sort((a, b) => a[0] - b[0]);
  if (points.length < 24) return new Map<number, [number, number]>();
  const prefix = [0];
  for (const point of points) prefix.push(prefix.at(-1)! + point[1]);
  const trends: number[] = [];
  let left = 0;
  let right = 0;
  for (let index = 0; index < points.length; index += 1) {
    while (points[left]?.[0] < points[index][0] - 12 * 3_600_000) left += 1;
    while (right < points.length && points[right][0] <= points[index][0] + 12 * 3_600_000) right += 1;
    trends[index] = (prefix[right] - prefix[left]) / Math.max(1, right - left);
  }
  const residuals = Array.from({ length: 24 }, () => [] as number[]);
  const referenceStart = latestGlobalMs - 7 * 86_400_000;
  points.forEach((point, index) => {
    if (point[0] >= referenceStart) residuals[argentinaHour(point[0])].push(point[1] - trends[index]);
  });
  const allResiduals = residuals.flat();
  const globalMean = allResiduals.reduce((sum, value) => sum + value, 0) / Math.max(1, allResiduals.length);
  const globalRms = Math.sqrt(allResiduals.reduce((sum, value) => sum + (value - globalMean) ** 2, 0) / Math.max(1, allResiduals.length));
  const statistics = residuals.map((values) => {
    if (!values.length) return { mean: globalMean, rms: globalRms };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const rms = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    return { mean, rms };
  });
  const result = new Map<number, [number, number]>();
  points.forEach((point) => {
    if (point[0] < minimumTimeMs) return;
    const stats = statistics[argentinaHour(point[0])];
    const lower = channel.id.includes("humidity") ? Math.max(0, point[1] - stats.rms) : point[1] - stats.rms;
    const upper = channel.id.includes("humidity") ? Math.min(100, point[1] + stats.rms) : point[1] + stats.rms;
    result.set(point[0], [lower, upper]);
  });
  return result;
}

function CompactWeatherChart({
  channels,
  events,
  range,
  latestGlobalMs,
  language,
  timeZone,
  forecast,
  showForecast,
  showReference,
}: {
  channels: Channel[];
  events: CryogenicEvent[];
  range: TimeRange;
  latestGlobalMs: number;
  language: Language;
  timeZone: DisplayTimeZone;
  forecast: WeatherForecast | null;
  showForecast: boolean;
  showReference: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState(() => channels.map((channel) => channel.id));
  const [zoomMode, setZoomMode] = useState(false);
  const [zoom, setZoom] = useState<ZoomDomain | null>(null);
  const hoverPointer = useMemo(() => createHoverPointerStore(), []);
  const activeZoom = zoom?.range === range ? zoom : null;
  const data = useMemo(() => {
    const base = mergeChartData(channels, selectedIds, range, latestGlobalMs);
    const rows = new Map<number, ChartDatum>(base.map((row) => [row.timeMs, { ...row }]));
    const duration = timeRangeDurations[range];
    const minimum = duration ? latestGlobalMs - duration : Number.NEGATIVE_INFINITY;
    if (showReference) {
      for (const channel of channels.filter((item) => selectedIds.includes(item.id) && !item.id.includes("wind"))) {
        for (const [timeMs, band] of rmsEnvelope(channel, minimum, latestGlobalMs)) {
          const row = rows.get(timeMs) ?? { timeMs };
          row[`band_${channel.id}`] = band;
          rows.set(timeMs, row);
        }
      }
    }
    if (showForecast && forecast) {
      const biases = forecastBiases(channels, forecast, latestGlobalMs);
      const maximumForecastMs = latestGlobalMs + forecastHorizon(range);
      for (const point of forecast.points) {
        if (point.timeMs <= latestGlobalMs || point.timeMs > maximumForecastMs) continue;
        const row = rows.get(point.timeMs) ?? { timeMs: point.timeMs };
        for (const channel of channels.filter((item) => selectedIds.includes(item.id))) {
          const field = forecastFields[channel.id];
          const value = field ? point[field] : null;
          if (typeof value === "number" && Number.isFinite(value)) {
            const adjusted = value + (biases.get(channel.id) ?? 0);
            row[`forecast_${channel.id}`] = channel.id === "site_humidity" ? Math.min(100, Math.max(0, adjusted)) : adjusted;
          }
        }
        rows.set(point.timeMs, row);
      }
    }
    return [...rows.values()].sort((a, b) => a.timeMs - b.timeMs);
  }, [channels, selectedIds, range, latestGlobalMs, forecast, showForecast, showReference]);
  const zoomKeys = selectedIds.flatMap((id) => [id, ...(showReference ? [`band_${id}`] : []), ...(showForecast ? [`forecast_${id}`] : [])]);
  const currentXDomain: [number, number] = activeZoom
    ? [activeZoom.xMin, activeZoom.xMax]
    : [data[0]?.timeMs ?? 0, data.at(-1)?.timeMs ?? 1];
  const currentYDomain: [number, number] = activeZoom ? [activeZoom.yMin, activeZoom.yMax] : chartExtent(data, zoomKeys);
  const visibleSpanMs = Math.max(1, currentXDomain[1] - currentXDomain[0]);
  const hoverCurves = useMemo(() => channels.flatMap((channel) => {
    if (!selectedIds.includes(channel.id)) return [];
    const curves = [makeHoverCurve(data, channel.id, channelName(channel, language), channel.unit, channel.color)];
    if (showForecast && forecastFields[channel.id]) curves.push(makeHoverCurve(data, `forecast_${channel.id}`, `${channelName(channel, language)} · ${translate(language, "forecast")}`, channel.unit, channel.color));
    return curves;
  }), [channels, data, language, selectedIds, showForecast]);

  function toggleChannel(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setZoom(null);
  }

  return (
    <article className={`weather-chart panel${channels.every((channel) => !channel.id.includes("wind")) ? " weather-chart-wide" : ""}`}>
      <div className="weather-chart-title">
        <div><h3>{channels.map((channel) => channel.label.replace(/^Site /, "")).join(" / ")}</h3><small>{channels.map((channel) => channel.sourceName).join(" · ")}</small></div>
        <div className="weather-chart-actions">
          <strong>{weatherValue(channels[0])}</strong>
        </div>
      </div>
      <div className="channel-selector weather-channel-selector" aria-label={translate(language, "visibleChannels")}>
        {channels.map((channel) => {
          const selected = selectedIds.includes(channel.id);
          return (
            <button type="button" key={channel.id} className={`channel-chip ${selected ? "selected" : ""}`} onClick={() => toggleChannel(channel.id)} aria-pressed={selected}>
              <span className="channel-swatch" style={{ backgroundColor: channel.color }} />
              <span className="channel-chip-copy"><strong>{channelName(channel, language)}</strong><small>{channel.sourceName}</small></span>
              <StatusDot status={channel.status} />
            </button>
          );
        })}
      </div>
      <div className="weather-chart-canvas">
        {data.length && selectedIds.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, left: 2, bottom: 2 }} onMouseMove={(state) => hoverPointer.set(state.activeCoordinate ?? null)} onMouseLeave={() => hoverPointer.set(null)}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
          <XAxis dataKey="timeMs" type="number" scale="time" domain={activeZoom ? [activeZoom.xMin, activeZoom.xMax] : ["dataMin", "dataMax"]} allowDataOverflow={Boolean(activeZoom)} tickFormatter={(value) => formatCompactDate(value, language, visibleSpanMs, timeZone)} stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 10 }} minTickGap={38} />
          <YAxis width={55} unit={` ${channels[0]?.unit ?? ""}`} tickFormatter={(value) => formatAxisTick(value, language)} stroke="#66758a" tick={{ fill: "#9aa8bb", fontSize: 10 }} domain={currentYDomain} allowDataOverflow />
          <DayBoundaryLines domain={currentXDomain} timeZone={timeZone} />
          <CryogenicPhaseLines events={events} domain={currentXDomain} language={language} />
          <Tooltip isAnimationActive={false} content={() => null} cursor={<NearestCurveCursor pointerStore={hoverPointer} curves={hoverCurves} xDomain={currentXDomain} yDomain={currentYDomain} language={language} timeZone={timeZone} />} />
          {channels.map((channel) => selectedIds.includes(channel.id) && showReference && !channel.id.includes("wind") ? <Area key={`band-${channel.id}`} type="monotone" dataKey={`band_${channel.id}`} name={`band_${channel.id}`} stroke="none" fill={channel.color} fillOpacity={0.15} connectNulls isAnimationActive={false} /> : null)}
          {channels.map((channel) => selectedIds.includes(channel.id) ? <Line key={channel.id} type="monotone" dataKey={channel.id} name={channel.id} stroke={channel.color} strokeWidth={2} dot={false} activeDot={false} connectNulls isAnimationActive={false} /> : null)}
          {channels.map((channel) => selectedIds.includes(channel.id) && showForecast && forecastFields[channel.id] ? <Line key={`forecast-${channel.id}`} type="monotone" dataKey={`forecast_${channel.id}`} name={`forecast_${channel.id}`} stroke={channel.color} strokeWidth={2} strokeDasharray="8 5" dot={false} activeDot={false} connectNulls isAnimationActive={false} /> : null)}
        </LineChart></ResponsiveContainer> : <div className="empty-chart">{translate(language, "emptyChart")}</div>}
        {data.length && selectedIds.length ? <BoxZoomOverlay enabled={zoomMode} language={language} onZoom={(selection) => { setZoom(zoomFromSelection(selection, range, currentXDomain, currentYDomain)); setZoomMode(false); }} /> : null}
      </div>
      <div className="weather-plot-controls">
        <ZoomControls enabled={zoomMode} setEnabled={setZoomMode} hasZoom={Boolean(activeZoom)} reset={() => setZoom(null)} language={language} />
      </div>
    </article>
  );
}

type WindSample = { timeMs: number; speed: number; direction: number };
type WindDensityWindow = "all" | "24h" | "7d";

function pairWindSamples(speedChannel?: Channel, directionChannel?: Channel) {
  if (!speedChannel || !directionChannel) return [] as WindSample[];
  const directions = new Map(directionChannel.points.map((point) => [point[0], point[1]]));
  return speedChannel.points.flatMap((point) => {
    const direction = directions.get(point[0]);
    return typeof direction === "number" && Number.isFinite(direction) && Number.isFinite(point[1])
      ? [{ timeMs: point[0], speed: Math.max(0, point[1]), direction: ((direction % 360) + 360) % 360 }]
      : [];
  });
}

function WindRoseChart({ speedChannel, directionChannel, range, latestGlobalMs, language }: { speedChannel?: Channel; directionChannel?: Channel; range: TimeRange; latestGlobalMs: number; language: Language }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [densityWindow, setDensityWindow] = useState<WindDensityWindow>("all");
  const samples = useMemo(() => pairWindSamples(speedChannel, directionChannel), [speedChannel, directionChannel]);
  const duration = timeRangeDurations[range];
  const recent = useMemo(() => samples.filter((sample) => !duration || sample.timeMs >= latestGlobalMs - duration), [samples, duration, latestGlobalMs]);
  const densitySamples = useMemo(() => {
    if (densityWindow === "24h") return samples.filter((sample) => sample.timeMs >= latestGlobalMs - 86_400_000);
    if (densityWindow === "7d") return samples.filter((sample) => sample.timeMs >= latestGlobalMs - 7 * 86_400_000);
    return samples;
  }, [samples, densityWindow, latestGlobalMs]);
  const current = samples.at(-1);
  const densityLabel = translate(language, densityWindow === "24h" ? "last24hDensity" : densityWindow === "7d" ? "last7dDensity" : "fullCooldownDensity");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const targetCanvas = canvas;
    const targetContainer = container;

    function draw() {
      const width = Math.max(320, targetContainer.clientWidth);
      const height = Math.max(360, targetContainer.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      targetCanvas.width = width * pixelRatio;
      targetCanvas.height = height * pixelRatio;
      targetCanvas.style.width = `${width}px`;
      targetCanvas.style.height = `${height}px`;
      const context = targetCanvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const centreX = width / 2;
      const centreY = height / 2 + 7;
      const radius = Math.min(width, height) * 0.39;
      const sortedSpeeds = samples.map((sample) => sample.speed).sort((a, b) => a - b);
      const percentile = sortedSpeeds[Math.floor(sortedSpeeds.length * 0.99)] ?? 40;
      const maximumSpeed = Math.max(20, Math.ceil(Math.max(percentile, current?.speed ?? 0) / 10) * 10);
      const angularBins = 32;
      const radialBins = 10;
      const histogram = Array.from({ length: angularBins }, () => Array(radialBins).fill(0) as number[]);
      for (const sample of densitySamples) {
        const angleIndex = Math.min(angularBins - 1, Math.floor(sample.direction / 360 * angularBins));
        const radiusIndex = Math.min(radialBins - 1, Math.floor(Math.min(sample.speed, maximumSpeed) / maximumSpeed * radialBins));
        histogram[angleIndex][radiusIndex] += 1;
      }
      const maximumCount = Math.max(1, ...histogram.flat());
      for (let angleIndex = 0; angleIndex < angularBins; angleIndex += 1) {
        const startAngle = angleIndex / angularBins * Math.PI * 2 - Math.PI / 2;
        const endAngle = (angleIndex + 1) / angularBins * Math.PI * 2 - Math.PI / 2;
        for (let radiusIndex = 0; radiusIndex < radialBins; radiusIndex += 1) {
          const count = histogram[angleIndex][radiusIndex];
          if (!count) continue;
          const innerRadius = radiusIndex / radialBins * radius;
          const outerRadius = (radiusIndex + 1) / radialBins * radius;
          const intensity = Math.log1p(count) / Math.log1p(maximumCount);
          context.beginPath();
          context.arc(centreX, centreY, outerRadius, startAngle, endAngle);
          context.arc(centreX, centreY, innerRadius, endAngle, startAngle, true);
          context.closePath();
          context.fillStyle = `hsla(${245 - intensity * 190}, 82%, ${18 + intensity * 42}%, ${0.22 + intensity * 0.66})`;
          context.fill();
        }
      }
      context.strokeStyle = "rgba(145, 162, 186, 0.28)";
      context.fillStyle = "rgba(185, 198, 216, 0.82)";
      context.font = "10px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let ring = 1; ring <= 4; ring += 1) {
        const ringRadius = radius * ring / 4;
        context.beginPath();
        context.arc(centreX, centreY, ringRadius, 0, Math.PI * 2);
        context.stroke();
        context.fillText(`${Math.round(maximumSpeed * ring / 4)}`, centreX + 5, centreY - ringRadius + 9);
      }
      const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      compass.forEach((label, index) => {
        const angle = index / compass.length * Math.PI * 2;
        context.beginPath();
        context.moveTo(centreX, centreY);
        context.lineTo(centreX + Math.sin(angle) * radius, centreY - Math.cos(angle) * radius);
        context.stroke();
        context.fillText(label, centreX + Math.sin(angle) * (radius + 18), centreY - Math.cos(angle) * (radius + 18));
      });
      context.font = "bold 10px Arial";
      context.fillStyle = "rgba(195, 210, 229, 0.88)";
      context.fillText("r · km/h", centreX + radius * 0.57, centreY - radius * 0.57);
      const oldestRecentMs = recent[0]?.timeMs ?? current?.timeMs ?? latestGlobalMs;
      const recentSpanMs = Math.max(1, (current?.timeMs ?? latestGlobalMs) - oldestRecentMs);
      recent.forEach((sample) => {
        const angle = sample.direction / 180 * Math.PI;
        const sampleRadius = Math.min(1, sample.speed / maximumSpeed) * radius;
        const x = centreX + Math.sin(angle) * sampleRadius;
        const y = centreY - Math.cos(angle) * sampleRadius;
        context.beginPath();
        context.arc(x, y, 2.2, 0, Math.PI * 2);
        const recency = Math.min(1, Math.max(0, (sample.timeMs - oldestRecentMs) / recentSpanMs));
        context.fillStyle = `rgba(204, 224, 232, ${0.035 + 0.36 * recency})`;
        context.fill();
      });
      if (current) {
        const angle = current.direction / 180 * Math.PI;
        const currentRadius = Math.min(1, current.speed / maximumSpeed) * radius;
        const startX = centreX + Math.sin(angle) * currentRadius;
        const startY = centreY - Math.cos(angle) * currentRadius;
        const endX = centreX + (startX - centreX) * 0.3;
        const endY = centreY + (startY - centreY) * 0.3;
        const arrowAngle = Math.atan2(endY - startY, endX - startX);
        context.strokeStyle = "rgba(6, 10, 18, 0.88)";
        context.lineWidth = 7;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
        context.strokeStyle = "#c82032";
        context.fillStyle = "#c82032";
        context.lineWidth = 4;
        context.shadowColor = "rgba(255, 45, 65, 0.62)";
        context.shadowBlur = 9;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
        context.beginPath();
        context.moveTo(endX, endY);
        context.lineTo(endX - 12 * Math.cos(arrowAngle - Math.PI / 6), endY - 12 * Math.sin(arrowAngle - Math.PI / 6));
        context.lineTo(endX - 12 * Math.cos(arrowAngle + Math.PI / 6), endY - 12 * Math.sin(arrowAngle + Math.PI / 6));
        context.closePath();
        context.fill();
        context.beginPath();
        context.arc(startX, startY, 5, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(targetContainer);
    return () => observer.disconnect();
  }, [samples, densitySamples, recent, current, latestGlobalMs]);

  return (
    <article className="panel wind-rose-card">
      <div className="wind-rose-heading">
        <div><p className="eyebrow">{densityLabel}</p><h3>{translate(language, "windRoseTitle")}</h3><p>{translate(language, "windRoseCopy")}</p></div>
        <div className="wind-rose-current"><strong>{current ? `${translate(language, "windFrom", { direction: directionToCompass(current.direction) })} · ${Math.round(current.direction)}° · ${current.speed.toFixed(1)} km/h` : "—"}</strong><div className="segmented density-window-selector" aria-label={translate(language, "fullCooldownDensity")}>
          {(["all", "24h", "7d"] as WindDensityWindow[]).map((windowId) => <button type="button" key={windowId} className={densityWindow === windowId ? "active" : ""} onClick={() => setDensityWindow(windowId)}>{translate(language, windowId === "24h" ? "last24hDensity" : windowId === "7d" ? "last7dDensity" : "fullCooldownDensity")}</button>)}
        </div></div>
      </div>
      <div className="wind-rose-canvas"><canvas ref={canvasRef} /></div>
      <div className="wind-density-legend"><span>{densityLabel}</span><i /></div>
    </article>
  );
}

function WeatherPanel({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  const [range, setRange] = useState<TimeRange>("48h");
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [forecastError, setForecastError] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [showReference, setShowReference] = useState(false);
  useEffect(() => {
    let active = true;
    async function loadForecast() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/weather-forecast", { cache: "no-cache" });
        if (!response.ok) throw new Error("Forecast unavailable");
        const data = await response.json() as WeatherForecast;
        if (active) { setForecast(data); setForecastError(false); }
      } catch {
        if (active) setForecastError(true);
      }
    }
    void loadForecast();
    const timer = window.setInterval(() => void loadForecast(), 30 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const byId = (ids: string[]) => ids.map((id) => snapshot.channels.find((channel) => channel.id === id)).filter(Boolean) as Channel[];
  const groups = [
    byId(["site_temperature", "inside_temperature"]),
    byId(["site_humidity", "inside_humidity"]),
    byId(["site_pressure"]),
    byId(["site_wind_speed"]),
    byId(["site_wind_direction"]),
  ].filter((channels) => channels.length);
  const standardGroups = groups.slice(0, 3);
  const windGroups = groups.slice(3);
  const speedChannel = snapshot.channels.find((channel) => channel.id === "site_wind_speed");
  const directionChannel = snapshot.channels.find((channel) => channel.id === "site_wind_direction");
  return (
    <div className="view-stack">
      <section className="panel section-intro weather-intro">
        <div><p className="eyebrow">{translate(language, "eyebrow.weather")}</p><h2>{translate(language, "weatherTitle")}</h2><p>{translate(language, "weatherCopy")}</p></div>
      </section>
      {showForecast ? <div className={`forecast-note ${forecastError ? "forecast-error" : ""}`}>{forecastError ? translate(language, "forecastUnavailable") : translate(language, "forecastSource")}</div> : null}
      <div className="weather-global-controls weather-plot-toolbar">
        <RangeSelector range={range} setRange={setRange} language={language} />
        <button type="button" className={`scale-toggle ${showForecast ? "active" : ""}`} onClick={() => setShowForecast((value) => !value)} aria-pressed={showForecast}>{translate(language, "forecast")}</button>
        <button type="button" className={`scale-toggle ${showReference ? "active" : ""}`} onClick={() => setShowReference((value) => !value)} aria-pressed={showReference} title={translate(language, "diurnalReferenceCopy")}>{translate(language, "diurnalReference")}</button>
      </div>
      <section className="weather-grid">
        {standardGroups.map((channels) => <CompactWeatherChart key={channels.map((channel) => channel.id).join("-")} channels={channels} events={snapshot.events} range={range} latestGlobalMs={snapshot.latestGlobalMs} language={language} timeZone={timeZone} forecast={forecast} showForecast={showForecast} showReference={showReference} />)}
        <div className="weather-wind-row">
          {windGroups.map((channels) => <CompactWeatherChart key={channels.map((channel) => channel.id).join("-")} channels={channels} events={snapshot.events} range={range} latestGlobalMs={snapshot.latestGlobalMs} language={language} timeZone={timeZone} forecast={forecast} showForecast={showForecast} showReference={showReference} />)}
        </div>
        <WindRoseChart speedChannel={speedChannel} directionChannel={directionChannel} range={range} latestGlobalMs={snapshot.latestGlobalMs} language={language} />
      </section>
    </div>
  );
}

const webcamIds = [1, 2, 3] as const;

function WebcamsPanel({ language, timeZone }: { language: Language; timeZone: DisplayTimeZone }) {
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const [cameraHealth, setCameraHealth] = useState<Record<number, boolean | null>>({ 1: null, 2: null, 3: null });
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const [captureNotice, setCaptureNotice] = useState("");
  const recordingRef = useRef<{ recorder: MediaRecorder; interval: number; timeout: number; stream: MediaStream; cancelled: boolean } | null>(null);

  function downloadBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
  }

  async function fetchCameraImage(cameraId: number) {
    const response = await fetch(`/api/webcams?id=${cameraId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Camera unavailable");
    return response.blob();
  }

  async function captureImage(cameraId: number) {
    try {
      const blob = await fetchCameraImage(cameraId);
      downloadBlob(blob, `QUBIC-camera-${cameraId}-${new Date().toISOString().replaceAll(":", "-")}.jpg`);
      setCaptureNotice("");
    } catch {
      setCaptureNotice(translate(language, "captureFailed"));
    }
  }

  function stopRecording(cancelled = false) {
    const recording = recordingRef.current;
    if (!recording) return;
    recording.cancelled = cancelled;
    window.clearInterval(recording.interval);
    window.clearTimeout(recording.timeout);
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    else recording.stream.getTracks().forEach((track) => track.stop());
    recordingRef.current = null;
    setRecordingId(null);
  }

  async function startRecording(cameraId: number) {
    if (recordingId === cameraId) {
      stopRecording();
      return;
    }
    if (recordingRef.current) stopRecording();
    if (!("MediaRecorder" in window) || !("createImageBitmap" in window)) {
      setCaptureNotice(translate(language, "videoUnsupported"));
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const stream = canvas.captureStream(5);
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const recordingState = { recorder, interval: 0, timeout: 0, stream, cancelled: false };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!recordingState.cancelled && chunks.length) {
          downloadBlob(new Blob(chunks, { type: recorder.mimeType || "video/webm" }), `QUBIC-camera-${cameraId}-${new Date().toISOString().replaceAll(":", "-")}.webm`);
        }
      };
      let drawing = false;
      const drawFrame = async () => {
        if (drawing || document.visibilityState !== "visible") return false;
        drawing = true;
        try {
          const blob = await fetchCameraImage(cameraId);
          const bitmap = await createImageBitmap(blob);
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          return true;
        } catch {
          setCaptureNotice(translate(language, "captureFailed"));
          return false;
        } finally {
          drawing = false;
        }
      };
      recordingRef.current = recordingState;
      if (!await drawFrame()) throw new Error("Initial camera frame unavailable");
      recorder.start(1_000);
      recordingState.interval = window.setInterval(() => void drawFrame(), 1_000);
      recordingState.timeout = window.setTimeout(() => stopRecording(), 30_000);
      setRecordingId(cameraId);
      setCaptureNotice("");
    } catch {
      setCaptureNotice(translate(language, "captureFailed"));
      stopRecording(true);
    }
  }

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") setRefreshKey(Date.now());
    };
    const timer = window.setInterval(refreshWhenVisible, 10_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      stopRecording(true);
    };
  }, []);

  return (
    <div className="view-stack">
      <section className="panel section-intro webcam-intro">
        <div>
          <p className="eyebrow">{translate(language, "eyebrow.webcams")}</p>
          <h2>{translate(language, "webcamsTitle")}</h2>
          <p>{translate(language, "webcamsCopy")}</p>
        </div>
        <span className="webcam-live-pill"><span className="live-dot" />{translate(language, "cameraLive")}</span>
      </section>
      <section className="webcam-grid">
        {webcamIds.map((cameraId) => (
          <article className="panel webcam-card" id={`webcam-card-${cameraId}`} key={cameraId}>
            <header>
              <div>
                <p className="eyebrow">Alto Chorrillos</p>
                <h3>{translate(language, `camera${cameraId}`)}</h3>
              </div>
              <span className={cameraHealth[cameraId] === false ? "camera-state camera-error" : "camera-state"}>
                <span className="live-dot" />
                {cameraHealth[cameraId] === false ? translate(language, "cameraUnavailable") : translate(language, "cameraLive")}
              </span>
            </header>
            <div className="webcam-frame">
              <img
                src={`/api/webcams?id=${cameraId}&v=${refreshKey}`}
                alt={`${translate(language, `camera${cameraId}`)} · Alto Chorrillos`}
                onLoad={() => setCameraHealth((current) => ({ ...current, [cameraId]: true }))}
                onError={() => setCameraHealth((current) => ({ ...current, [cameraId]: false }))}
              />
              {cameraHealth[cameraId] === false ? <div className="webcam-error">{translate(language, "cameraUnavailable")}</div> : null}
              {recordingId === cameraId ? <div className="webcam-recording"><span className="live-dot" />{translate(language, "recording")}</div> : null}
            </div>
            <div className="webcam-actions">
              <button type="button" onClick={() => void document.getElementById(`webcam-card-${cameraId}`)?.requestFullscreen()}>{translate(language, "enlarge")}</button>
              <button type="button" onClick={() => void captureImage(cameraId)}>{translate(language, "captureImage")}</button>
              <button type="button" className={recordingId === cameraId ? "recording" : ""} onClick={() => void startRecording(cameraId)}>{translate(language, recordingId === cameraId ? "stopRecording" : "recordVideo")}</button>
            </div>
            <footer><span>{formatDate(refreshKey, language, timeZone)}</span><span>{translate(language, "recordingLimit")}</span></footer>
          </article>
        ))}
      </section>
      {captureNotice ? <div className="source-warning" role="status"><span className="warning-icon">!</span><div><strong>{captureNotice}</strong></div></div> : null}
    </div>
  );
}

function EventsPanel({ events, language, timeZone }: { events: CryogenicEvent[]; language: Language; timeZone: DisplayTimeZone }) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const beginning = byId.get("beginning-of-data");
  const pumping = byId.get("pumping");
  const mainComplete = byId.get("main-cooldown-complete");
  const mainEvents = events.filter((event) => ["cooling_start", "cooling_260k", "stage_40k", "stage_4k"].includes(event.type));
  const subKEvents = events.filter((event) => event.type === "subkelvin" || event.type === "subkelvin_cycle");
  const mainStartMs = mainEvents
    .filter((event) => event.type === "cooling_start" && event.timeMs !== null)
    .reduce<number | null>((first, event) => first === null ? event.timeMs : Math.min(first, event.timeMs as number), null);
  const phases = [
    { id: "data", title: "timelinePhaseData", copy: "timelinePhaseDataCopy", startMs: beginning?.timeMs ?? null, endMs: null, events: [] as CryogenicEvent[] },
    { id: "pumping", title: "timelinePhasePumping", copy: "timelinePhasePumpingCopy", startMs: pumping?.timeMs ?? null, endMs: null, events: [] as CryogenicEvent[] },
    { id: "main", title: "timelinePhaseMain", copy: "timelinePhaseMainCopy", startMs: mainStartMs, endMs: mainComplete?.timeMs ?? null, events: mainEvents },
    { id: "subk", title: "timelinePhaseSubK", copy: "timelinePhaseSubKCopy", startMs: mainComplete?.timeMs ?? null, endMs: null, events: subKEvents },
  ];

  return (
    <section className="panel events-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{translate(language, "automaticMarkers")}</p>
          <h2>{translate(language, "cryogenicTimeline")}</h2>
        </div>
        <button type="button" className="quiet-button" title={translate(language, "editingSoon")}>
          {translate(language, "review")}
        </button>
      </div>
      <div className="event-list">
        {phases.map((phase, phaseIndex) => (
          <section className={`timeline-phase timeline-phase-${phase.id}`} key={phase.id}>
            <header className="timeline-phase-heading">
              <span className="timeline-phase-index">{String(phaseIndex + 1).padStart(2, "0")}</span>
              <div>
                <div className="timeline-phase-line">
                  <h3>{translate(language, phase.title)}</h3>
                  <time>
                    {formatTimelineDate(phase.startMs, language, timeZone)}
                    {phase.endMs ? ` → ${formatTimelineDate(phase.endMs, language, timeZone)}` : ""}
                  </time>
                </div>
                <p>{translate(language, phase.copy)}</p>
              </div>
            </header>
            {phase.events.length ? (
              <div className="timeline-phase-events">
                {phase.events.map((event) => (
                  <article className={`event-item event-${event.status}`} key={event.id}>
                    <div className="event-marker" />
                    <div className="event-line">
                      <strong>{translate(language, `event.${event.id}.title`)}</strong>
                      <span>{formatTimelineDate(event.timeMs, language, timeZone)}</span>
                      {event.status === "pending" ? <small>{translate(language, "insufficientData")}</small> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}

function ColdPhasePanel({ snapshot, language }: { snapshot: MonitoringSnapshot; language: Language }) {
  const oneKelvin = snapshot.channels.find((channel) => channel.id === "avs47_1_ch1");
  return (
    <div className="view-stack">
      <section className="cold-hero">
        <div>
          <p className="eyebrow">{translate(language, "subKSequence")}</p>
          <h2>{translate(language, "coldTitle")}</h2>
          <p>{translate(language, "coldCopy")}</p>
        </div>
        <div className="cold-reading">
          <span>{translate(language, "latest1K")}</span>
          <strong>{formatValue(oneKelvin)} K</strong>
          <small>{formatAge(oneKelvin?.ageMs ?? null, language)}</small>
        </div>
      </section>
      <section className="phase-grid">
        <article className="phase-card phase-complete">
          <span>01</span>
          <h3>{translate(language, "phase1Title")}</h3>
          <p>{translate(language, "phase1Copy")}</p>
        </article>
        <article className="phase-card phase-waiting">
          <span>02</span>
          <h3>{translate(language, "phase2Title")}</h3>
          <p>{translate(language, "phase2Copy")}</p>
        </article>
        <article className="phase-card phase-ready">
          <span>03</span>
          <h3>{translate(language, "phase3Title")}</h3>
          <p>{translate(language, "phase3Copy")}</p>
        </article>
      </section>
      <section className="panel cycle-placeholder">
        <div>
          <p className="eyebrow">{translate(language, "nextCapability")}</p>
          <h2>{translate(language, "cycleReferenceTitle")}</h2>
          <p>{translate(language, "cycleReferenceCopy")}</p>
        </div>
        <div className="reference-band" aria-label={translate(language, "referenceBand")}>
          <div className="reference-line" />
          <span>{translate(language, "referenceBand")}</span>
        </div>
      </section>
    </div>
  );
}

function ComparisonPanel({ snapshot, language }: { snapshot: MonitoringSnapshot; language: Language }) {
  const [alignment, setAlignment] = useState("260k");
  const [selectedCooldowns, setSelectedCooldowns] = useState([snapshot.cooldown.label]);
  const cooldowns = Array.from(
    new Set(["Sep 2020", "Mar 2022", "Mar 2024", "Jul 2025", "Aug 2025", snapshot.cooldown.label]),
  );

  function toggleCooldown(label: string) {
    setSelectedCooldowns((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  }

  return (
    <div className="view-stack">
      <section className="panel comparison-controls">
        <div>
          <p className="eyebrow">{translate(language, "comparisonLab")}</p>
          <h2>{translate(language, "comparisonTitle")}</h2>
        </div>
        <label>
          {translate(language, "timeMarker")}
          <select value={alignment} onChange={(event) => setAlignment(event.target.value)}>
            <option value="260k">{translate(language, "crossing260")}</option>
            <option value="4k" disabled>
              {translate(language, "stable4K")}
            </option>
            <option value="cycle" disabled>
              {translate(language, "cycleStart")}
            </option>
          </select>
        </label>
      </section>
      <section className="comparison-layout">
        <aside className="panel cooldown-picker">
          <p className="eyebrow">{translate(language, "cooldowns")}</p>
          {cooldowns.map((label) => (
            <button
              type="button"
              key={label}
              className={selectedCooldowns.includes(label) ? "selected" : ""}
              onClick={() => toggleCooldown(label)}
            >
              <span>{label}</span>
              <small>{label === snapshot.cooldown.label ? translate(language, "current") : translate(language, "toImport")}</small>
            </button>
          ))}
        </aside>
        <div className="panel comparison-stage">
          <div className="comparison-axis">
            <span>{translate(language, "daysBefore")}</span>
            <span>{translate(language, "eventT0")}</span>
            <span>{translate(language, "daysAfter")}</span>
          </div>
          <div className="comparison-empty">
            <div className="alignment-mark">t₀</div>
            <strong>{translate(language, "selectedCooldowns", { count: selectedCooldowns.length })}</strong>
            <p>{translate(language, "comparisonEmpty")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SourcesPanel({ snapshot, language, timeZone }: { snapshot: MonitoringSnapshot; language: Language; timeZone: DisplayTimeZone }) {
  return (
    <section className="panel source-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{translate(language, "acquisitionQuality")}</p>
          <h2>{translate(language, "perChannelFreshness")}</h2>
          <p className="panel-copy">{translate(language, "sourceCopy")}</p>
        </div>
        <div className="source-count">
          <strong>{snapshot.sourceHealth.total}</strong>
          <span>{translate(language, "importedSources")}</span>
        </div>
      </div>
      <div className="source-table-wrap">
        <table className="source-table">
          <thead>
            <tr>
              <th>{translate(language, "tableChannel")}</th>
              <th>{translate(language, "tableStatus")}</th>
              <th>{translate(language, "tableLatest")}</th>
              <th>{translate(language, "tableValue")}</th>
              <th>{translate(language, "tableSamples")}</th>
              <th>{translate(language, "tableQuality")}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  <strong>{channelName(channel, language)}</strong>
                  <small>{channel.sourceName} · {channel.source}</small>
                </td>
                <td>
                  <span className={`status-badge badge-${channel.status}`}>
                    <StatusDot status={channel.status} />
                    {translate(language, `status.${channel.status}`)}
                  </span>
                </td>
                <td>
                  {formatDate(channel.latestMs, language, timeZone)}
                  <small>{formatAge(channel.ageMs, language)}</small>
                </td>
                <td className="table-value">
                  {formatValue(channel)} {channel.unit}
                </td>
                <td>{channel.sampleCount.toLocaleString(locales[language])}</td>
                <td>
                  <span className={channel.suspectCount ? "quality-warning" : "quality-good"}>
                    {channel.suspectCount
                      ? translate(language, "suspect", { count: channel.suspectCount.toLocaleString(locales[language]) })
                      : translate(language, "valid")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MonitoringDashboard() {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [view, setView] = useState<View>("monitoring");
  const [housekeepingView, setHousekeepingView] = useState<HousekeepingView>("temperatures");
  const [language, setLanguage] = useState<Language>("en");
  const [timeZone, setTimeZone] = useState<DisplayTimeZone>("Europe/Paris");
  const [loadError, setLoadError] = useState(false);
  const snapshotVersionRef = useRef<number | null>(null);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("qubic-language");
    let restoreTimer: number | undefined;
    if (languageOptions.some((option) => option.id === savedLanguage)) {
      const restoredLanguage = savedLanguage as Language;
      restoreTimer = window.setTimeout(() => setLanguage(restoredLanguage), 0);
    }
    const savedTimeZone = window.localStorage.getItem("qubic-time-zone");
    if (timeZoneOptions.some((option) => option.id === savedTimeZone)) {
      window.setTimeout(() => setTimeZone(savedTimeZone as DisplayTimeZone), 0);
    }

    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let hasLoaded = false;

    async function loadSnapshot() {
      try {
        try {
          const statusResponse = await fetch("/data/monitoring-status.json", { cache: "no-cache" });
          if (statusResponse.ok) {
            const status = await statusResponse.json() as { generatedAtMs?: number };
            if (typeof status.generatedAtMs === "number" && snapshotVersionRef.current === status.generatedAtMs) {
              hasLoaded = true;
              setLoadError(false);
              return;
            }
          }
        } catch { /* Fall back to the complete snapshot when the small status file is unavailable. */ }
        const response = await fetch("/data/monitoring-snapshot.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("Snapshot unavailable");
        const data = (await response.json()) as MonitoringSnapshot;
        if (!active) return;
        hasLoaded = true;
        snapshotVersionRef.current = data.generatedAtMs;
        setSnapshot((current) => current?.generatedAtMs === data.generatedAtMs ? current : data);
        setLoadError(false);
      } catch {
        if (active && !hasLoaded) setLoadError(true);
      }
    }

    void loadSnapshot();
    const refreshTimer = window.setInterval(() => void loadSnapshot(), 30_000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locales[language];
  }, [language]);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    window.localStorage.setItem("qubic-language", nextLanguage);
  }

  function changeTimeZone(nextTimeZone: DisplayTimeZone) {
    setTimeZone(nextTimeZone);
    window.localStorage.setItem("qubic-time-zone", nextTimeZone);
  }

  if (loadError) {
    return (
      <main className="loading-state">
        <img className="brand-logo" src="/logo-qubic.png" alt="QUBIC" />
        <p className="eyebrow">QUBIC Monitoring</p>
        <h1>{translate(language, "loadError")}</h1>
        <p>{translate(language, "loadErrorHelp")}</p>
      </main>
    );
  }

  if (!snapshot) return <LoadingState language={language} />;

  const translatedViews = viewLabels(language);
  const currentView = translatedViews.find((item) => item.id === view) ?? translatedViews[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo-qubic.png" alt="QUBIC" />
          <div>
            <strong>QUBIC</strong>
            <span>Monitoring</span>
          </div>
        </div>

        <nav className="main-nav" aria-label={translate(language, "navigation")}>
          {translatedViews.map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <span className="nav-glyph">{item.label.slice(0, 1)}</span>
              <span>
                <small>{item.eyebrow}</small>
                {item.label}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="site-note">
          <span className="site-pulse" />
          Alto Chorrillos · 4 869 m
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentView.eyebrow}</p>
            <h1>{currentView.label}</h1>
          </div>
          <div className="topbar-actions">
            <label className="language-select">
              <span aria-hidden="true">◎</span>
              <select
                value={language}
                onChange={(event) => changeLanguage(event.target.value as Language)}
                aria-label="Language"
              >
                {languageOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.short} · {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="timezone-pill">
              <span>{translate(language, "timezone")}</span>
              <select value={timeZone} onChange={(event) => changeTimeZone(event.target.value as DisplayTimeZone)} aria-label={translate(language, "timezone")}>
                {timeZoneOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" className="cooldown-select" aria-label={translate(language, "displayedCooldown")}>
              <span className="live-dot" />
              <span>
                <small>{translate(language, "currentCooldown")}</small>
                {snapshot.cooldown.label}
              </span>
              <b>⌄</b>
            </button>
          </div>
        </header>

        <div className="content">
          <figure className="observatory-banner">
            <img src="/og-qubic-geometry-reference.png" alt={translate(language, "observatoryAlt")} />
          </figure>

          {view === "monitoring" ? (
            <div className="view-stack">
              <HousekeepingSelector snapshot={snapshot} selected={housekeepingView} setSelected={setHousekeepingView} language={language} />
              <SourceWarning snapshot={snapshot} language={language} />
              {housekeepingView === "temperatures" ? (
                <section className="dashboard-grid">
                  <TemperatureChart snapshot={snapshot} language={language} timeZone={timeZone} />
                  <EventsPanel events={snapshot.events} language={language} timeZone={timeZone} />
                </section>
              ) : null}
              {housekeepingView === "pressure" ? <PressurePanel snapshot={snapshot} language={language} timeZone={timeZone} /> : null}
              {housekeepingView === "touch" ? <TouchPanel snapshot={snapshot} language={language} timeZone={timeZone} /> : null}
              {housekeepingView === "compressors" ? <CompressorsPanel snapshot={snapshot} language={language} timeZone={timeZone} /> : null}
              {housekeepingView === "weather" ? <WeatherPanel snapshot={snapshot} language={language} timeZone={timeZone} /> : null}
            </div>
          ) : null}

          {view === "cycles" ? <ColdPhasePanel snapshot={snapshot} language={language} /> : null}
          {view === "compare" ? <ComparisonPanel snapshot={snapshot} language={language} /> : null}
          {view === "sources" ? <SourcesPanel snapshot={snapshot} language={language} timeZone={timeZone} /> : null}
          {view === "webcams" ? <WebcamsPanel language={language} timeZone={timeZone} /> : null}
        </div>

        <footer className="footer">
          <span>
            {translate(language, "snapshotGenerated", { date: formatDate(snapshot.generatedAtMs, language, timeZone) })}
            {" · "}{translate(language, "automaticRefresh")}
          </span>
          <span>QUBIC · Q&U Bolometric Interferometer for Cosmology</span>
        </footer>
      </main>
    </div>
  );
}
