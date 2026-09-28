require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));

const CORKGIGS_URL = "https://www.corkgigs.com/";
const EVENTBRITE_BASE_URL = "https://www.eventbriteapi.com/v3";
const OSRM_FOOT_ROUTE_URL =
  "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN || "";
const VENUE_CACHE_FILE = path.join(__dirname, "venue-cache.json");
const VENUE_CACHE_SEED_FILE = path.join(
  __dirname,
  "data",
  "venue-cache-seed.json"
);
const VENUE_OVERRIDES_FILE = path.join(__dirname, "venue-overrides.json");
const EVENT_CATEGORY_OVERRIDES_FILE = path.join(
  __dirname,
  "data",
  "event-category-overrides.json"
);

const CORK_CITY_CENTRE = {
  lat: 51.8985,
  lng: -8.4756
};

const TOURIST_PLACES_FILE = path.join(
  __dirname,
  "data",
  "tourist-places.json"
);
const TOURIST_CITY_RADIUS_KM = 8;

const TOURIST_INTEREST_OPTIONS = new Set([
  "balanced",
  "food",
  "history",
  "riverside",
  "local"
]);

const TOURIST_PACE_OPTIONS = new Set([
  "quick",
  "standard",
  "relaxed"
]);

const TOURIST_PACE_PROFILES = {
  quick: {
    label: "Quick loop",
    targetRouteKm: 1.4,
    maxSegmentKm: 1.35,
    maxPlaceToEventKm: 2.4,
    visitMultiplier: 0.65,
    arrivalBufferMinutes: 10
  },
  standard: {
    label: "Standard pace",
    targetRouteKm: 2.2,
    maxSegmentKm: 2.0,
    maxPlaceToEventKm: 3.6,
    visitMultiplier: 1,
    arrivalBufferMinutes: 15
  },
  relaxed: {
    label: "Relaxed wander",
    targetRouteKm: 3.1,
    maxSegmentKm: 2.8,
    maxPlaceToEventKm: 5,
    visitMultiplier: 1.2,
    arrivalBufferMinutes: 20
  }
};

const SURPRISE_EVENT_TYPES = new Set([
  "any",
  "music",
  "comedy",
  "nightlife",
  "trad"
]);

const SURPRISE_PRICE_OPTIONS = new Set(["any", "free", "paid"]);
const SURPRISE_DISTANCE_OPTIONS = new Set(["centre", "nearby", "any"]);
const SURPRISE_DISTANCE_LIMITS = {
  centre: 3,
  nearby: 8
};

const DISCOVER_SCOPE_OPTIONS = new Set(["centre", "nearby", "any"]);
const DISCOVER_SCOPE_LIMITS = {
  centre: 3,
  nearby: 8
};


const EVENT_FILTER_CATEGORIES = [
  {
    id: "all",
    label: "All events",
    shortLabel: "All",
    icon: "/icons/event-categories/all.svg"
  },
  {
    id: "music",
    label: "Live music",
    shortLabel: "Music",
    icon: "/icons/event-categories/music.svg"
  },
  {
    id: "nightlife",
    label: "Nightlife",
    shortLabel: "Nightlife",
    icon: "/icons/event-categories/nightlife.svg"
  },
  {
    id: "comedy",
    label: "Comedy",
    shortLabel: "Comedy",
    icon: "/icons/event-categories/comedy.svg"
  },
  {
    id: "trad",
    label: "Traditional",
    shortLabel: "Trad",
    icon: "/icons/event-categories/trad.svg"
  },
  {
    id: "open-mic",
    label: "Open mic",
    shortLabel: "Open mic",
    icon: "/icons/event-categories/open-mic.svg"
  },
  {
    id: "festivals",
    label: "Festivals",
    shortLabel: "Festivals",
    icon: "/icons/event-categories/festivals.svg"
  },
  {
    id: "free",
    label: "Free events",
    shortLabel: "Free",
    icon: "/icons/event-categories/free.svg"
  }
];

const EVENT_CONTENT_CATEGORY_IDS = new Set(
  EVENT_FILTER_CATEGORIES
    .map(category => category.id)
    .filter(id => !["all", "free"].includes(id))
);

const EVENT_FILTER_CATEGORY_IDS = new Set([
  ...EVENT_CONTENT_CATEGORY_IDS,
  "free"
]);

const EVENT_CATEGORY_BY_ID = Object.fromEntries(
  EVENT_FILTER_CATEGORIES.map(category => [category.id, category])
);

// Development-only fix for CorkGigs certificate issue
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

let cachedEvents = [];
let lastFetched = 0;
let eventsFetchPromise = null;
const CACHE_TIME = 15 * 60 * 1000;
const EVENT_DETAIL_CACHE_TIME = 30 * 60 * 1000;
const EVENTBRITE_CACHE_TIME = 30 * 60 * 1000;
const PAGE_METADATA_CACHE_TIME = 30 * 60 * 1000;
const eventDetailCache = new Map();
const eventbriteEventCache = new Map();
const eventbriteMatchCache = new Map();
const pageMetadataCache = new Map();
const eventPreviewCache = new Map();
const EVENT_PREVIEW_CACHE_TIME = 60 * 60 * 1000;
const bookingPriceCache = new Map();
const BOOKING_PRICE_CACHE_TIME = 30 * 60 * 1000;
const eventbriteFetchErrors = new Map();
const touristWalkingRouteCache = new Map();
const TOURIST_WALKING_ROUTE_CACHE_TIME = 30 * 60 * 1000;

function cleanText(text) {
  return (text || "")
    .replace(/\uFFFD/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const CORKGIGS_MONTH_NUMBERS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function normaliseIsoDate(value = "") {
  const cleaned = cleanText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return "";
  }

  const [year, month, day] = cleaned.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return cleaned;
}

function parseCorkGigsDateToIso(dateText = "") {
  const match = cleanText(dateText).match(
    /(?:^[A-Za-z]{3}\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/
  );

  if (!match) {
    return "";
  }

  const day = Number(match[1]);
  const month = CORKGIGS_MONTH_NUMBERS[match[2].toLowerCase()];
  const year = Number(match[3]);

  if (!month) {
    return "";
  }

  return normaliseIsoDate(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
}

function formatIsoDateForDisplay(value = "") {
  const isoDate = normaliseIsoDate(value);

  if (!isoDate) {
    return "";
  }

  const [year, month, day] = isoDate.split("-").map(Number);

  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function buildDateRangeSummary(startDate = "", endDate = "") {
  if (startDate && endDate) {
    if (startDate === endDate) {
      return formatIsoDateForDisplay(startDate);
    }

    return `${formatIsoDateForDisplay(startDate)} to ${formatIsoDateForDisplay(endDate)}`;
  }

  if (startDate) {
    return `From ${formatIsoDateForDisplay(startDate)}`;
  }

  if (endDate) {
    return `Up to ${formatIsoDateForDisplay(endDate)}`;
  }

  return "All upcoming dates";
}

function loadTouristPlaces() {
  try {
    const raw = fs.readFileSync(TOURIST_PLACES_FILE, "utf8");
    const places = JSON.parse(raw);

    if (!Array.isArray(places)) {
      throw new Error("tourist-places.json must contain an array");
    }

    return places
      .map(place => ({
        id: cleanText(place.id),
        title: cleanText(place.title),
        category: cleanText(place.category || "local"),
        categoryLabel: cleanText(place.categoryLabel || "Local Cork"),
        description: cleanText(place.description),
        area: cleanText(place.area || "Cork city centre"),
        access: cleanText(place.access || "outdoor"),
        eveningFriendly: place.eveningFriendly !== false,
        recommendedMinutes: Number(place.recommendedMinutes || 30),
        tags: Array.isArray(place.tags)
          ? place.tags.map(tag => cleanText(tag).toLowerCase()).filter(Boolean)
          : [],
        coordinates: {
          lat: Number(place.coordinates?.lat),
          lng: Number(place.coordinates?.lng)
        }
      }))
      .filter(place => {
        return (
          place.id &&
          place.title &&
          Number.isFinite(place.coordinates.lat) &&
          Number.isFinite(place.coordinates.lng)
        );
      });
  } catch (error) {
    console.log("Could not load tourist-places.json:", error.message);
    return [];
  }
}

const TOURIST_PLACES = loadTouristPlaces();

function loadEventCategoryOverrides() {
  try {
    if (!fs.existsSync(EVENT_CATEGORY_OVERRIDES_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(EVENT_CATEGORY_OVERRIDES_FILE, "utf8");
    const overrides = JSON.parse(raw);

    if (!Array.isArray(overrides)) {
      throw new Error("event-category-overrides.json must contain an array");
    }

    return overrides
      .map(override => {
        const match = cleanText(override.match || "").toLowerCase();
        const categories = Array.isArray(override.categories)
          ? [...new Set(
              override.categories
                .map(category => cleanText(category).toLowerCase())
                .filter(category => EVENT_CONTENT_CATEGORY_IDS.has(category))
            )]
          : [];
        const primaryCategory = cleanText(
          override.primaryCategory || ""
        ).toLowerCase();

        return {
          match,
          categories,
          primaryCategory: categories.includes(primaryCategory)
            ? primaryCategory
            : ""
        };
      })
      .filter(override => override.match && override.categories.length > 0);
  } catch (error) {
    console.log(
      "Could not load event-category-overrides.json:",
      error.message
    );
    return [];
  }
}

const EVENT_CATEGORY_OVERRIDES = loadEventCategoryOverrides();

function findEventCategoryOverride(event) {
  const eventText = cleanText(
    `${event.title || ""} ${event.venue || ""}`
  ).toLowerCase();

  const matches = EVENT_CATEGORY_OVERRIDES.filter(override => {
    return eventText.includes(override.match);
  });

  if (matches.length === 0) {
    return null;
  }

  const categories = [
    ...new Set(matches.flatMap(override => override.categories))
  ];
  const primaryCategory = matches
    .map(override => override.primaryCategory)
    .find(category => categories.includes(category));

  return {
    categories,
    primaryCategory: primaryCategory || ""
  };
}

function parseSelectedEventCategories(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  return [
    ...new Set(
      rawValues
        .flatMap(item => String(item || "").split(","))
        .map(item => cleanText(item).toLowerCase())
        .filter(item => EVENT_FILTER_CATEGORY_IDS.has(item))
    )
  ];
}

function classifyEventForDiscover(event) {
  const text = cleanText(
    `${event.title || ""} ${event.venue || ""}`
  ).toLowerCase();

  const categories = new Set();

  const explicitMusicPattern =
    /\b(?:gig|gigs|concert|band|singer|songwriter|orchestra|choir|jazz|rock|punk|metal|reggae|ska|blues|album|music|tribute|acoustic|session)\b/;

  if (
    /\b(?:festival|fest|fests|fair|fairs|carnival|feile|féile)\b/.test(text)
  ) {
    categories.add("festivals");
  }

  if (
    /\bcomedy\b|stand[ -]?up|comedian|comic night|improv|sketch comedy/.test(text)
  ) {
    categories.add("comedy");
  }

  if (
    /open[ -]?mic|open stage|songwriters?[’']? night|jam session/.test(text)
  ) {
    categories.add("open-mic");
  }

  if (
    /\btrad\b|traditional music|trad session|irish session|céilí|ceili|folk session|irish folk/.test(text)
  ) {
    categories.add("trad");
  }

  if (
    /\[dj\]|\bdj\b|club night|nightclub|techno|house music|disco|rave|dance party|afterparty|electronic night/.test(text)
  ) {
    categories.add("nightlife");
  }

  const categoryOverride = findEventCategoryOverride(event);

  if (categoryOverride) {
    categoryOverride.categories.forEach(category => {
      categories.add(category);
    });
  }

  /*
   * Trad, DJ/nightlife and open-mic listings are also musical events.
   * This keeps them discoverable through the broader Music filter while
   * retaining their more useful specialist category as the primary label.
   */
  if (
    categories.has("trad") ||
    categories.has("nightlife") ||
    categories.has("open-mic")
  ) {
    categories.add("music");
  }

  if (explicitMusicPattern.test(text)) {
    categories.add("music");
  }

  if (categories.size === 0) {
    categories.add("music");
  }

  if (event.priceType === "free") {
    categories.add("free");
  }

  const primaryPriority = [
    "comedy",
    "open-mic",
    "trad",
    "nightlife",
    "festivals",
    "music"
  ];

  const overridePrimary = categoryOverride?.primaryCategory;
  const primaryCategory =
    (overridePrimary && categories.has(overridePrimary)
      ? overridePrimary
      : primaryPriority.find(category => categories.has(category))) ||
    "music";
  const definition = EVENT_CATEGORY_BY_ID[primaryCategory];

  return {
    categories: [...categories],
    primaryCategory,
    categoryLabel: definition?.label || "Live music",
    categoryShortLabel: definition?.shortLabel || "Music",
    categoryIcon: definition?.icon || "/icons/event-categories/music.svg"
  };
}

function eventMatchesSelectedCategories(event, selectedCategories) {
  if (!selectedCategories.length) {
    return true;
  }

  const selectedContentCategories = selectedCategories.filter(category => {
    return EVENT_CONTENT_CATEGORY_IDS.has(category);
  });
  const requiresFree = selectedCategories.includes("free");

  const matchesContent =
    selectedContentCategories.length === 0 ||
    selectedContentCategories.some(category => {
      return event.categories?.includes(category);
    });

  const matchesFree = !requiresFree || event.priceType === "free";

  return matchesContent && matchesFree;
}

function normaliseDiscoverScope(value) {
  const scope = cleanText(value || "").toLowerCase();
  return DISCOVER_SCOPE_OPTIONS.has(scope) ? scope : "any";
}

function getDiscoverScopeLabel(scope) {
  const labels = {
    centre: "within 3 km of Cork city centre",
    nearby: "within 8 km of Cork city centre",
    any: "anywhere in the Cork listings"
  };

  return labels[scope] || labels.any;
}

function eventMatchesDiscoverScope(event, scope) {
  if (scope === "any") {
    return true;
  }

  const limit = DISCOVER_SCOPE_LIMITS[scope];
  const distance = event.distanceFromCentreKm;

  return (
    Number.isFinite(distance) &&
    Number.isFinite(limit) &&
    distance <= limit
  );
}

function scorePersonalisedDiscoverEvent(
  event,
  selectedCategories,
  selectedPrice,
  selectedScope
) {
  let score = 0;

  const selectedContentCategories = selectedCategories.filter(category => {
    return EVENT_CONTENT_CATEGORY_IDS.has(category);
  });

  const categoryMatches = selectedContentCategories.filter(category => {
    return event.categories?.includes(category);
  }).length;

  score += categoryMatches * 20;

  if (selectedCategories.includes("free") && event.priceType === "free") {
    score += 12;
  }

  if (selectedPrice && event.priceType === selectedPrice) {
    score += 10;
  }

  if (event.ticketUrl) {
    score += 3;
  }

  if (Number.isFinite(event.distanceFromCentreKm)) {
    const distance = event.distanceFromCentreKm;

    if (selectedScope === "centre") {
      score += Math.max(0, 12 - distance * 3);
    } else if (selectedScope === "nearby") {
      score += Math.max(0, 10 - distance);
    } else {
      score += Math.max(0, 5 - distance * 0.2);
    }
  }

  if (event.priceType === "free") {
    score += 1;
  }

  return score;
}

function sortPersonalisedDiscoverEvents(
  events,
  selectedCategories,
  selectedPrice,
  selectedScope
) {
  return [...events].sort((first, second) => {
    const scoreDifference =
      scorePersonalisedDiscoverEvent(
        second,
        selectedCategories,
        selectedPrice,
        selectedScope
      ) -
      scorePersonalisedDiscoverEvent(
        first,
        selectedCategories,
        selectedPrice,
        selectedScope
      );

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    const firstDate = first.isoDate || "9999-12-31";
    const secondDate = second.isoDate || "9999-12-31";

    if (firstDate !== secondDate) {
      return firstDate.localeCompare(secondDate);
    }

    const timeDifference =
      parseEventTimeToMinutes(first.time) -
      parseEventTimeToMinutes(second.time);

    if (timeDifference !== 0) {
      return timeDifference;
    }

    return first.title.localeCompare(second.title);
  });
}

function normalizeVenueKey(venueName) {
  return cleanText(venueName)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadVenueCache() {
  const cacheFile = fs.existsSync(VENUE_CACHE_FILE)
    ? VENUE_CACHE_FILE
    : VENUE_CACHE_SEED_FILE;

  if (!fs.existsSync(cacheFile)) {
    return {};
  }

  try {
    const data = fs.readFileSync(cacheFile, "utf8");
    const parsed = JSON.parse(data);
    const normalized = {};

    Object.keys(parsed).forEach(key => {
      normalized[normalizeVenueKey(key)] = parsed[key];
    });

    return normalized;
  } catch (error) {
    console.log(
      `Could not read ${path.basename(cacheFile)}:`,
      error.message
    );
    return {};
  }
}

function loadVenueOverrides() {
  if (!fs.existsSync(VENUE_OVERRIDES_FILE)) {
    return {};
  }

  try {
    const data = fs.readFileSync(VENUE_OVERRIDES_FILE, "utf8");
    const parsed = JSON.parse(data);
    const normalized = {};

    Object.keys(parsed).forEach(key => {
      const normalKey = normalizeVenueKey(key);
      const apostropheFreeKey = normalKey.replace(/['’]/g, "");

      normalized[normalKey] = parsed[key];
      normalized[apostropheFreeKey] = parsed[key];
    });

    return normalized;
  } catch (error) {
    console.log("Could not read venue-overrides.json:", error.message);
    return {};
  }
}

let venueCache = loadVenueCache();
let venueOverrides = loadVenueOverrides();

function saveVenueCache() {
  fs.writeFileSync(
    VENUE_CACHE_FILE,
    JSON.stringify(venueCache, null, 2)
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeAbsoluteUrl(link) {
  if (!link) return CORKGIGS_URL;

  try {
    return new URL(link, CORKGIGS_URL).href;
  } catch {
    return CORKGIGS_URL;
  }
}


function isUsefulPageUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const corkGigsRoot = new URL(CORKGIGS_URL);

    return !(
      parsed.hostname === corkGigsRoot.hostname &&
      parsed.pathname.replace(/\/+$/, "") ===
        corkGigsRoot.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

function makeAbsolutePageUrl(link, pageUrl) {
  if (!link) return "";

  try {
    return new URL(link, pageUrl).href;
  } catch {
    return "";
  }
}

function choosePageImage($, pageUrl) {
  const metaImage =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[property="twitter:image"]').attr("content");

  if (metaImage) {
    return makeAbsolutePageUrl(metaImage, pageUrl);
  }

  const imageCandidates = $("img")
    .map((index, image) => {
      const src = $(image).attr("src") || $(image).attr("data-src") || "";
      const alt = cleanText($(image).attr("alt") || "").toLowerCase();
      const width = Number($(image).attr("width") || 0);
      const height = Number($(image).attr("height") || 0);

      return {
        src: makeAbsolutePageUrl(src, pageUrl),
        alt,
        width,
        height
      };
    })
    .get()
    .filter(image => {
      if (!image.src) return false;

      const combined = `${image.src} ${image.alt}`.toLowerCase();
      const looksDecorative =
        combined.includes("logo") ||
        combined.includes("icon") ||
        combined.includes("sprite") ||
        combined.includes("facebook") ||
        combined.includes("twitter") ||
        combined.includes("instagram");

      if (looksDecorative) return false;
      if (image.width && image.width < 240) return false;
      if (image.height && image.height < 140) return false;

      return true;
    });

  return imageCandidates[0]?.src || "";
}

function stripDescriptionHtml(value = "") {
  if (!value) {
    return "";
  }

  const fragment = cheerio.load(
    `<div id="vibelee-description">${String(value)}</div>`
  );

  fragment(
    "script, style, noscript, template, svg, canvas, iframe"
  ).remove();

  return cleanText(
    fragment("#vibelee-description").text()
  );
}

function looksLikeJavascriptText(text = "") {
  const value = cleanText(text);

  if (!value) {
    return false;
  }

  const javascriptPatterns = [
    /\bvar\s+[a-z_$][\w$]*\s*=/i,
    /\blet\s+[a-z_$][\w$]*\s*=/i,
    /\bconst\s+[a-z_$][\w$]*\s*=/i,
    /\bfunction\s+[a-z_$][\w$]*\s*\(/i,
    /\$\s*\(\s*window\s*\)/i,
    /\$\s*\(\s*document\s*\)/i,
    /\$\s*\(\s*["'][.#a-z]/i,
    /\bwindow\.(?:resize|width|height|location)/i,
    /\bdocument\.getElementById\b/i,
    /\bdocument\.querySelector\b/i,
    /\bgetElementById\s*\(/i,
    /\.style\.(?:display|visibility|width|height)\s*=/i,
    /\belse\s*\{/i,
    /\bif\s*\([^)]*\)\s*\{/i,
    /\breturn\s+[a-z_$][\w$]*\s*;/i,
    /\bclose_all\s*\(/i,
    /\bfind_my_div\s*\(/i,
    /\/\/\s*(?:hide|show|find|close|alert|window)/i
  ];

  const matchedPatterns = javascriptPatterns.filter(pattern =>
    pattern.test(value)
  ).length;

  const semicolonCount =
    (value.match(/;/g) || []).length;

  const braceCount =
    (value.match(/[{}]/g) || []).length;

  const codeTokenCount =
    (
      value.match(
        /\b(?:function|document|window|style|display|return|else|var|const|jquery)\b/gi
      ) || []
    ).length;

  return (
    matchedPatterns >= 2 ||
    codeTokenCount >= 5 ||
    (semicolonCount >= 4 && braceCount >= 2) ||
    (
      value.includes("document.getElementById") &&
      value.includes("style.display")
    )
  );
}

function looksLikeDescriptionBoilerplate(text = "") {
  const value = cleanText(text).toLowerCase();

  if (!value) {
    return true;
  }

  const boilerplatePatterns = [
    /^cookie/i,
    /we use cookies/i,
    /accept all cookies/i,
    /privacy policy/i,
    /sign up to (?:our|the) mailing list/i,
    /subscribe to (?:our|the) newsletter/i,
    /all rights reserved/i,
    /follow us on/i,
    /copyright\s*[©(]/i,
    /^home\s+about\s+contact/i,
    /enable javascript/i,
    /your browser does not support/i
  ];

  return boilerplatePatterns.some(pattern =>
    pattern.test(value)
  );
}

function cleanDescriptionCandidate(value = "") {
  const text = stripDescriptionHtml(value);

  if (text.length < 40) {
    return "";
  }

  if (text.length > 5000) {
    return "";
  }

  if (looksLikeJavascriptText(text)) {
    return "";
  }

  if (looksLikeDescriptionBoilerplate(text)) {
    return "";
  }

  return text;
}

function getJsonLdEventDescription($) {
  const descriptions = [];

  function inspectJsonLd(value) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(inspectJsonLd);
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const rawTypes = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];

    const isEvent = rawTypes
      .filter(Boolean)
      .some(type =>
        /(?:^|:)event$/i.test(String(type)) ||
        /musicEvent$/i.test(String(type)) ||
        /comedyEvent$/i.test(String(type)) ||
        /theaterEvent$/i.test(String(type))
      );

    if (isEvent && value.description) {
      descriptions.push(
        cleanDescriptionCandidate(value.description)
      );
    }

    Object.values(value).forEach(childValue => {
      if (
        childValue &&
        typeof childValue === "object"
      ) {
        inspectJsonLd(childValue);
      }
    });
  }

  $('script[type="application/ld+json"]').each(
    (index, script) => {
      const jsonText = $(script).html();

      if (!jsonText) {
        return;
      }

      try {
        inspectJsonLd(JSON.parse(jsonText));
      } catch {
        // Ignore malformed structured data.
      }
    }
  );

  return descriptions.find(Boolean) || "";
}

function scoreDescriptionCandidate(text = "") {
  const sentenceCount =
    (text.match(/[.!?](?:\s|$)/g) || []).length;

  const wordCount =
    text.split(/\s+/).filter(Boolean).length;

  let score = Math.min(text.length, 1200);

  score += Math.min(sentenceCount, 10) * 40;
  score += Math.min(wordCount, 250);

  if (text.length < 80) {
    score -= 150;
  }

  if (/^(tickets?|price|date|time|venue):?/i.test(text)) {
    score -= 100;
  }

  return score;
}

function choosePageDescription($) {
  /*
   * Structured event data is usually the cleanest source.
   */
  const jsonLdDescription =
    getJsonLdEventDescription($);

  if (jsonLdDescription) {
    return jsonLdDescription;
  }

  /*
   * Check metadata, but reject it when it contains code,
   * cookie notices or other template content.
   */
  const metaDescriptions = [
    $('meta[property="og:description"]').attr("content"),
    $('meta[name="description"]').attr("content"),
    $('meta[name="twitter:description"]').attr("content")
  ];

  for (const metaDescription of metaDescriptions) {
    const cleaned =
      cleanDescriptionCandidate(metaDescription);

    if (cleaned) {
      return cleaned;
    }
  }

  /*
   * Rebuild a clean copy of the page and completely remove
   * scripts and non-content elements before reading paragraphs.
   */
  const safePage = cheerio.load($.html());

  safePage(
    [
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      "canvas",
      "iframe",
      "nav",
      "header",
      "footer",
      "form",
      ".cookie-notice",
      ".cookie-banner",
      ".newsletter",
      ".mailing-list",
      ".social-links",
      ".site-navigation",
      ".menu"
    ].join(",")
  ).remove();

  const descriptionSelectors = [
    ".tribe-events-single-event-description p",
    ".tribe-events-single-event-description",
    ".event-description p",
    ".event-description",
    ".event-content p",
    ".event-content",
    ".gig-description p",
    ".gig-description",
    ".entry-content p",
    "[itemprop='description'] p",
    "[itemprop='description']",
    "main article p",
    "main p",
    "article p",
    ".content p",
    "#content p",
    "body p"
  ];

  for (const selector of descriptionSelectors) {
    const candidates = safePage(selector)
      .map((index, element) => {
        const elementClone =
          safePage(element).clone();

        elementClone
          .find(
            [
              "script",
              "style",
              "noscript",
              "template",
              "svg",
              "button",
              "form"
            ].join(",")
          )
          .remove();

        return cleanDescriptionCandidate(
          elementClone.text()
        );
      })
      .get()
      .filter(Boolean)
      .filter((value, index, allValues) => {
        return allValues.indexOf(value) === index;
      })
      .sort((first, second) => {
        return (
          scoreDescriptionCandidate(second) -
          scoreDescriptionCandidate(first)
        );
      });

    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  return "";
}

function stripUrlFragment(url = "") {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return cleanText(url).split("#")[0];
  }
}

function getUrlHostname(url = "") {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSameOriginUrl(firstUrl = "", secondUrl = "") {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

function isBlockedUtilityUrl(url = "") {
  if (!url) return true;

  const lowerUrl = url.toLowerCase();

  const blockedFragments = [
    // Social and sharing services
    "facebook.com",
    "fb.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "youtube.com",
    "linkedin.com/sharing",
    "pinterest.",
    "reddit.com/submit",
    "wa.me/",
    "api.whatsapp.com",

    // Calendar services and downloads
    "calendar.google.com",
    "google.com/calendar",
    "outlook.live.com/calendar",
    "outlook.office.com/calendar",
    "calendar.yahoo.com",

    // Maps and directions
    "maps.google.",
    "google.com/maps",
    "maps.apple.com",
    "openstreetmap.org/directions"
  ];

  if (blockedFragments.some(fragment => lowerUrl.includes(fragment))) {
    return true;
  }

  if (
    lowerUrl.startsWith("webcal:") ||
    lowerUrl.startsWith("geo:") ||
    lowerUrl.startsWith("mailto:") ||
    lowerUrl.startsWith("tel:") ||
    lowerUrl.startsWith("javascript:") ||
    lowerUrl === "#"
  ) {
    return true;
  }

  if (
    lowerUrl.endsWith(".ics") ||
    lowerUrl.includes(".ics?") ||
    lowerUrl.includes("action=template") ||
    lowerUrl.includes("add-to-calendar") ||
    lowerUrl.includes("add_to_calendar") ||
    lowerUrl.includes("ical=") ||
    lowerUrl.includes("tribe-bar-date=") ||
    lowerUrl.includes("eventdisplay=past")
  ) {
    return true;
  }

  return false;
}

function isGenericTicketUrl(url = "") {
  if (!url) return true;

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsedUrl.pathname.toLowerCase().replace(/\/+$/, "");

    const genericPaths = new Set([
      "",
      "/tickets",
      "/ticket",
      "/shop",
      "/events",
      "/event",
      "/calendar",
      "/whats-on",
      "/whatson",
      "/gig-guide",
      "/product-category/tickets",
      "/product-category/ticket"
    ]);

    if (genericPaths.has(pathname)) {
      return true;
    }

    // Ticket Tailor organiser page without an individual event ID.
    if (
      hostname.includes("tickettailor.com") &&
      /^\/events\/[^/]+$/.test(pathname)
    ) {
      return true;
    }

    // Eventbrite discovery/organiser pages are not individual bookings.
    if (
      hostname.includes("eventbrite.") &&
      !/\/e\/.+-\d{6,}(?:\/|$)/i.test(pathname)
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function isTrustedTicketProvider(url = "") {
  const lowerUrl = url.toLowerCase();

  return [
    "eventbrite.",
    "tickettailor.com",
    "ticketmaster.",
    "ticketsolve.",
    "dice.fm",
    "universe.com",
    "wegottickets.com",
    "ticketweb.",
    "tickets.ie",
    "eventim.",
    "seetickets.",
    "skiddle.",
    "residentadvisor.net",
    "eventgenius.",
    "ticketebo.",
    "ticketco.events",
    "ticketsource.",
    "eventix.",
    "vivenu.com"
  ].some(domain => lowerUrl.includes(domain));
}

function isIndividualProviderEventUrl(url = "") {
  const lowerUrl = url.toLowerCase();

  return (
    /eventbrite\.(ie|com|co\.uk)\/e\/.+-\d{6,}/i.test(lowerUrl) ||
    /tickettailor\.com\/events\/[^/]+\/\d+/i.test(lowerUrl) ||
    /ticketmaster\.[^/]+\/event\//i.test(lowerUrl) ||
    /ticketmaster\.[^/]+\/.*\d{6,}/i.test(lowerUrl) ||
    /ticketsolve\.[^/]+\/ticketbooth\/shows\//i.test(lowerUrl) ||
    /dice\.fm\/event\//i.test(lowerUrl) ||
    /universe\.com\/events\//i.test(lowerUrl) ||
    /wegottickets\.com\/event\//i.test(lowerUrl) ||
    /ticketweb\.[^/]+\/event\//i.test(lowerUrl) ||
    /seetickets\.[^/]+\/event\//i.test(lowerUrl) ||
    /skiddle\.com\/whats-on\/[^/]+\/[^/]+\/\d+/i.test(lowerUrl)
  );
}

function isNonTicketBookingText(text = "") {
  const normalised = cleanText(text).toLowerCase();

  return /\b(book (a |your )?(table|room|stay|dinner|meal|restaurant|wedding|tour|shuttle|bus|transfer)|dinner reservation|restaurant reservation|reserve a table|accommodation|hotel booking|transport|shuttle|sea church express|parking|directions|add to calendar|google calendar|share this event|newsletter)\b/i.test(
    normalised
  );
}

function hasStrongTicketText(text = "") {
  return /\b(get tickets?|book tickets?|buy tickets?|purchase tickets?|tickets? on sale|secure tickets?|admission|entry tickets?|checkout)\b/i.test(
    cleanText(text)
  );
}

function hasGeneralTicketText(text = "") {
  return /\b(tickets?|ticketing|box office|booking)\b/i.test(cleanText(text));
}

function hasEmbeddedTicketInterface($) {
  const strongSelectors = [
    ".tribe-tickets__tickets-form",
    ".tribe-tickets__tickets-item",
    ".tribe-tickets__tickets-buy",
    ".tribe-common.event-tickets",
    ".event-tickets",
    "[data-js='tribe-tickets']",
    "[id*='tribe-tickets']",
    "[class*='tribe-tickets']",
    "form[class*='ticket']",
    "form[id*='ticket']",
    ".woocommerce form.cart"
  ];

  if ($(strongSelectors.join(",")).length > 0) {
    return true;
  }

  const ticketSection = $(
    [
      "section",
      "article",
      ".entry-content",
      ".event-content",
      ".tribe-events-single",
      "main",
      "#content"
    ].join(",")
  )
    .filter((index, element) => {
      const text = cleanText($(element).text());
      return (
        /\b(get tickets?|buy tickets?|purchase tickets?|ticket quantity|tickets? available|sold out)\b/i.test(
          text
        ) &&
        $(element).find("form, button, input[type='number'], input[type='submit']")
          .length > 0
      );
    })
    .first();

  return ticketSection.length > 0;
}

function scoreTicketUrl(url = "", pageUrl = "") {
  if (!url || isBlockedUtilityUrl(url) || isGenericTicketUrl(url)) {
    return -1000;
  }

  const lowerUrl = url.toLowerCase();

  if (isIndividualProviderEventUrl(url)) {
    return 500;
  }

  if (isTrustedTicketProvider(url)) {
    return 360;
  }

  if (
    /\/(checkout|ticket-checkout|booking|book-tickets?|buy-tickets?|tickets?)(\/|$|\?|#)/i.test(
      lowerUrl
    )
  ) {
    return 180;
  }

  if (pageUrl && stripUrlFragment(url) === stripUrlFragment(pageUrl)) {
    return 130;
  }

  if (/\/(event|events|gig|gigs|show|shows)\//i.test(lowerUrl)) {
    return 70;
  }

  return 20;
}

function extractUrlsFromText(value = "", pageUrl = "") {
  const urls = [];
  const directPattern = /https?:\/\/[^\s"'<>\\]+/gi;
  const matches = String(value || "").match(directPattern) || [];

  matches.forEach(match => {
    const cleaned = match.replace(/[),.;]+$/g, "");
    const absolute = makeAbsolutePageUrl(cleaned, pageUrl);
    if (absolute) urls.push(absolute);
  });

  return urls;
}

function extractStructuredTicketUrls($, pageUrl) {
  const urls = [];

  function addUrl(value) {
    if (typeof value !== "string") return;

    const absolute = makeAbsolutePageUrl(value, pageUrl);
    if (absolute && !isBlockedUtilityUrl(absolute)) {
      urls.push(absolute);
    }
  }

  function visitOffers(value) {
    if (Array.isArray(value)) {
      value.forEach(visitOffers);
      return;
    }

    if (!value || typeof value !== "object") return;

    addUrl(value.url);
    addUrl(value["@id"]);

    Object.values(value).forEach(child => {
      if (child && typeof child === "object") {
        visitOffers(child);
      }
    });
  }

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") return;

    const typeValue = value["@type"];
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    const isEvent = types.some(type => /event/i.test(String(type || "")));
    const isOffer = types.some(type => /offer/i.test(String(type || "")));

    if (isEvent && value.offers) {
      visitOffers(value.offers);
    }

    if (isOffer) {
      visitOffers(value);
    }

    Object.values(value).forEach(child => {
      if (child && typeof child === "object") {
        visit(child);
      }
    });
  }

  $('script[type="application/ld+json"]').each((index, script) => {
    const raw = $(script).html();
    if (!raw) return;

    try {
      visit(JSON.parse(raw));
    } catch {
      // Ignore malformed structured data.
    }
  });

  return [...new Set(urls)];
}

function chooseTicketTarget($, pageUrl) {
  const candidates = [];
  const embeddedTickets = hasEmbeddedTicketInterface($);

  function addCandidate({
    url,
    label = "",
    source = "link",
    index = 0,
    inTicketSection = false,
    inNavigation = false,
    structured = false
  }) {
    const absoluteUrl = makeAbsolutePageUrl(url, pageUrl);

    if (!absoluteUrl || isBlockedUtilityUrl(absoluteUrl)) return;

    const description = cleanText(label);
    const negativeContext = isNonTicketBookingText(description);
    const strongTicketText = hasStrongTicketText(description);
    const generalTicketText = hasGeneralTicketText(description);
    const trustedProvider = isTrustedTicketProvider(absoluteUrl);
    const individualProvider = isIndividualProviderEventUrl(absoluteUrl);
    const samePage = stripUrlFragment(absoluteUrl) === stripUrlFragment(pageUrl);

    if (
      !strongTicketText &&
      !generalTicketText &&
      !trustedProvider &&
      !individualProvider &&
      !structured &&
      !(samePage && embeddedTickets)
    ) {
      return;
    }

    let score = scoreTicketUrl(absoluteUrl, pageUrl);

    if (individualProvider) score += 260;
    else if (trustedProvider) score += 150;

    if (strongTicketText) score += 240;
    else if (generalTicketText) score += 80;

    if (inTicketSection) score += 170;
    if (structured) score += 140;
    if (samePage && embeddedTickets) score += 260;
    if (inNavigation) score -= 260;
    if (negativeContext) score -= 700;

    if (isGenericTicketUrl(absoluteUrl) && !samePage) {
      score -= 700;
    }

    candidates.push({
      url: absoluteUrl,
      score,
      source,
      index,
      description,
      reason: [
        individualProvider ? "individual provider event" : "",
        trustedProvider ? "trusted ticket provider" : "",
        strongTicketText ? "strong ticket label" : "",
        inTicketSection ? "ticket section" : "",
        structured ? "structured event offer" : "",
        samePage && embeddedTickets ? "embedded ticket checkout" : ""
      ]
        .filter(Boolean)
        .join(", ")
    });
  }

  extractStructuredTicketUrls($, pageUrl).forEach((url, index) => {
    addCandidate({
      url,
      label: "structured event offer ticket URL",
      source: "structured-data",
      index,
      structured: true
    });
  });

  $("a").each((index, link) => {
    const element = $(link);
    const href = element.attr("href");
    if (!href) return;

    const label = [
      element.text(),
      element.attr("title"),
      element.attr("aria-label"),
      element.find("img").attr("alt"),
      element.attr("class"),
      element.attr("id")
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" ");

    const inNavigation =
      element.closest(
        "header, nav, footer, .navbar, .navigation, .menu, .site-header, .site-footer"
      ).length > 0;

    const inTicketSection =
      element.closest(
        ".tribe-tickets__tickets-form, .tribe-tickets__tickets-item, .event-tickets, [id*='ticket'], [class*='ticket'], .woocommerce form.cart"
      ).length > 0;

    addCandidate({
      url: href,
      label,
      source: "anchor",
      index,
      inTicketSection,
      inNavigation
    });
  });

  $("form").each((index, form) => {
    const element = $(form);
    const action = element.attr("action") || pageUrl;
    const label = [
      element.text(),
      element.attr("class"),
      element.attr("id")
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" ");

    const inTicketSection =
      element.is(
        ".tribe-tickets__tickets-form, .event-tickets form, form[class*='ticket'], form[id*='ticket'], .woocommerce form.cart"
      ) ||
      element.closest("[id*='ticket'], [class*='ticket']").length > 0;

    addCandidate({
      url: action,
      label,
      source: "form",
      index: 10000 + index,
      inTicketSection
    });
  });

  $("[data-url], [data-href], [data-ticket-url], [data-checkout-url], [onclick]").each(
    (index, elementNode) => {
      const element = $(elementNode);
      const values = [
        element.attr("data-url"),
        element.attr("data-href"),
        element.attr("data-ticket-url"),
        element.attr("data-checkout-url"),
        element.attr("onclick")
      ].filter(Boolean);
      const label = [
        element.text(),
        element.attr("title"),
        element.attr("aria-label"),
        element.attr("class"),
        element.attr("id")
      ]
        .map(cleanText)
        .filter(Boolean)
        .join(" ");

      values.forEach(value => {
        const directUrl = makeAbsolutePageUrl(value, pageUrl);
        const extractedUrls = extractUrlsFromText(value, pageUrl);
        const urls = extractedUrls.length > 0 ? extractedUrls : [directUrl];

        urls.forEach(url => {
          addCandidate({
            url,
            label,
            source: "data-attribute",
            index: 20000 + index,
            inTicketSection:
              element.closest("[id*='ticket'], [class*='ticket']").length > 0
          });
        });
      });
    }
  );

  // Sites such as Sea Church and De Barra sell through an embedded
  // ticket form on the individual event page. The event page itself is
  // the correct booking destination and is safer than an unrelated
  // reservation, calendar, transport or venue-shop link.
  if (embeddedTickets) {
    addCandidate({
      url: stripUrlFragment(pageUrl),
      label: "Get tickets embedded checkout",
      source: "embedded-event-page",
      index: 30000,
      inTicketSection: true
    });
  }

  candidates.sort((first, second) => {
    if (second.score !== first.score) return second.score - first.score;
    return first.index - second.index;
  });

  const best = candidates.find(candidate => candidate.score >= 150);

  return {
    url: best?.url || "",
    confidence:
      best?.score >= 600 ? "high" : best?.score >= 300 ? "medium" : best ? "low" : "none",
    reason: best?.reason || "",
    source: best?.source || "",
    hasEmbeddedTickets: embeddedTickets,
    candidates: candidates.slice(0, 8)
  };
}

function chooseTicketLink($, pageUrl) {
  return chooseTicketTarget($, pageUrl).url;
}

function chooseBestTicketUrl(...candidateUrls) {
  const uniqueUrls = [
    ...new Set(
      candidateUrls
        .flat()
        .filter(Boolean)
        .map(url => cleanText(url))
    )
  ];

  return (
    uniqueUrls
      .map((url, index) => ({
        url,
        index,
        score: scoreTicketUrl(url)
      }))
      .filter(candidate => {
        return (
          !isBlockedUtilityUrl(candidate.url) &&
          !isGenericTicketUrl(candidate.url) &&
          candidate.score > 0
        );
      })
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score;
        }

        return first.index - second.index;
      })[0]?.url || ""
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

function getDecodedVariants(value) {
  const variants = [];
  let current = decodeHtmlEntities(value);

  for (let index = 0; index < 5; index += 1) {
    if (!current || variants.includes(current)) break;
    variants.push(current);

    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decodeHtmlEntities(decoded);
    } catch {
      break;
    }
  }

  return variants;
}

function isEventbriteUrl(url) {
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");

    return (
      hostname === "eventbrite.com" ||
      hostname.endsWith(".eventbrite.com") ||
      hostname === "eventbrite.ie" ||
      hostname.endsWith(".eventbrite.ie") ||
      hostname === "eventbrite.co.uk" ||
      hostname.endsWith(".eventbrite.co.uk")
    );
  } catch {
    return false;
  }
}

function cleanExtractedUrl(url) {
  return String(url || "")
    .replace(/&amp;/gi, "&")
    .replace(/[),.;]+$/g, "")
    .trim();
}

function extractEventbriteUrlsFromValue(value, baseUrl = CORKGIGS_URL) {
  const found = new Set();
  const queue = getDecodedVariants(value);
  const seen = new Set();
  const directPattern = /(?:https?:)?\/\/(?:www\.)?eventbrite\.(?:com|ie|co\.uk)\/[^\s"'<>\\]+/gi;

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    for (const variant of getDecodedVariants(candidate)) {
      const matches = variant.match(directPattern) || [];

      matches.forEach(match => {
        const absolute = match.startsWith("//") ? `https:${match}` : match;
        const cleaned = cleanExtractedUrl(absolute);
        if (isEventbriteUrl(cleaned)) found.add(cleaned);
      });

      try {
        const parsed = new URL(variant, baseUrl);

        if (isEventbriteUrl(parsed.href)) {
          found.add(cleanExtractedUrl(parsed.href));
        }

        parsed.searchParams.forEach(paramValue => {
          getDecodedVariants(paramValue).forEach(decoded => {
            if (!seen.has(decoded)) queue.push(decoded);
          });
        });
      } catch {
        // The value may be JavaScript or raw HTML rather than a URL.
      }
    }
  }

  return Array.from(found);
}

function extractEventbriteEventId(value) {
  const urls = isEventbriteUrl(value)
    ? [cleanExtractedUrl(value)]
    : extractEventbriteUrlsFromValue(value);

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const queryId =
        parsed.searchParams.get("event_id") ||
        parsed.searchParams.get("eid") ||
        parsed.searchParams.get("id");

      if (queryId && /^\d{6,}$/.test(queryId)) {
        return queryId;
      }

      const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
      const patterns = [
        /tickets[-_/](\d{6,})$/i,
        /tickets-(\d{6,})$/i,
        /-(\d{6,})$/i,
        /\/(\d{6,})$/
      ];

      for (const pattern of patterns) {
        const match = pathname.match(pattern);
        if (match) return match[1];
      }
    } catch {
      // Try the next candidate URL.
    }
  }

  return "";
}

function findEventbriteUrlInScope($, scope, pageUrl) {
  const values = [];
  const root = scope && typeof scope.find === "function" ? scope : $.root();

  values.push(root.html() || "");

  root.find("*").addBack().each((index, element) => {
    Object.values(element.attribs || {}).forEach(value => values.push(value));
  });

  const urls = values.flatMap(value => extractEventbriteUrlsFromValue(value, pageUrl));
  const uniqueUrls = Array.from(new Set(urls));

  return (
    uniqueUrls.find(url => extractEventbriteEventId(url)) ||
    uniqueUrls[0] ||
    ""
  );
}

function chooseEventbriteLink($, pageUrl) {
  const canonicalValues = [
    $('link[rel="canonical"]').attr("href"),
    $('meta[property="og:url"]').attr("content"),
    $('meta[name="twitter:url"]').attr("content"),
    $('meta[http-equiv="refresh"]').attr("content")
  ].filter(Boolean);

  for (const value of canonicalValues) {
    const url = extractEventbriteUrlsFromValue(value, pageUrl)
      .find(candidate => extractEventbriteEventId(candidate));
    if (url) return url;
  }

  return findEventbriteUrlInScope($, $.root(), pageUrl);
}


function getCurrencySymbol(currency = "EUR") {
  const normalised = cleanText(currency).toUpperCase();

  const symbols = {
    EUR: "€",
    GBP: "£",
    USD: "$"
  };

  return symbols[normalised] || `${normalised || "EUR"} `;
}

function parseMoneyNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalised = String(value)
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/[^0-9.-]/g, "");

  const amount = Number(normalised);

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function formatCurrencyAmount(amount, currency = "EUR") {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return "";
  }

  const symbol = getCurrencySymbol(currency);
  const formatted = Number.isInteger(numericAmount)
    ? numericAmount.toFixed(0)
    : numericAmount.toFixed(2);

  return `${symbol}${formatted}`;
}

function createUnknownPriceInfo() {
  return {
    priceType: "unknown",
    priceLabel: "Price not confirmed",
    priceSource: "unknown",
    priceNote: "",
    priceConfidence: "none",
    minPrice: null,
    maxPrice: null,
    currency: "EUR"
  };
}

function extractMoneyAmounts(text = "") {
  const value = cleanText(text);
  const matches = [];
  const patterns = [
    /(?:€|EUR\s*)\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi,
    /(?:£|GBP\s*)\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi,
    /(?:\$|USD\s*)\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi
  ];

  patterns.forEach(pattern => {
    let match;

    while ((match = pattern.exec(value)) !== null) {
      const amount = parseMoneyNumber(match[1]);

      if (amount !== null) {
        const marker = match[0].toUpperCase();
        const currency =
          marker.includes("£") || marker.includes("GBP")
            ? "GBP"
            : marker.includes("$") || marker.includes("USD")
              ? "USD"
              : "EUR";

        matches.push({ amount, currency });
      }
    }
  });

  return matches;
}

function getPriceFeeNote(textValues = []) {
  const text = cleanText(textValues.filter(Boolean).join(" ")).toLowerCase();

  if (
    /\b(?:plus|\+)\s*(?:a\s*)?(?:booking|service|transaction|processing)\s*fee/i.test(
      text
    ) ||
    /\bfees?\s*(?:apply|extra|additional)\b/i.test(text)
  ) {
    return "Booking fees may be added at checkout.";
  }

  if (
    /\b(?:including|includes|incl\.?)\s*(?:all\s*)?(?:booking|service|transaction|processing)?\s*fees?\b/i.test(
      text
    )
  ) {
    return "The advertised price includes booking fees.";
  }

  return "";
}

function buildPriceInfoFromAmounts(
  amounts,
  {
    source = "booking-page",
    confidence = "medium",
    textValues = [],
    forceFree = false
  } = {}
) {
  const validAmounts = (amounts || [])
    .filter(item => Number.isFinite(item?.amount) && item.amount >= 0)
    .map(item => ({
      amount: Number(item.amount),
      currency: cleanText(item.currency || "EUR").toUpperCase() || "EUR"
    }));

  const positiveAmounts = validAmounts.filter(item => item.amount > 0);

  if (forceFree && positiveAmounts.length === 0) {
    return {
      priceType: "free",
      priceLabel: "Free",
      priceSource: source,
      priceNote: getPriceFeeNote(textValues),
      priceConfidence: confidence,
      minPrice: 0,
      maxPrice: 0,
      currency: validAmounts[0]?.currency || "EUR"
    };
  }

  if (positiveAmounts.length === 0) {
    return createUnknownPriceInfo();
  }

  const preferredCurrency =
    positiveAmounts.find(item => item.currency === "EUR")?.currency ||
    positiveAmounts[0].currency ||
    "EUR";

  const sameCurrencyAmounts = positiveAmounts
    .filter(item => item.currency === preferredCurrency)
    .map(item => item.amount);

  const uniqueAmounts = [...new Set(sameCurrencyAmounts)]
    .sort((first, second) => first - second);

  const minimum = uniqueAmounts[0];
  const maximum = uniqueAmounts[uniqueAmounts.length - 1];
  let priceLabel = formatCurrencyAmount(minimum, preferredCurrency);
  let priceNote = getPriceFeeNote(textValues);

  if (maximum > minimum) {
    priceLabel = `From ${formatCurrencyAmount(minimum, preferredCurrency)}`;

    const rangeNote =
      `Multiple ticket prices are listed, up to ` +
      `${formatCurrencyAmount(maximum, preferredCurrency)}.`;

    priceNote = [rangeNote, priceNote].filter(Boolean).join(" ");
  }

  return {
    priceType: "paid",
    priceLabel,
    priceSource: source,
    priceNote,
    priceConfidence: confidence,
    minPrice: minimum,
    maxPrice: maximum,
    currency: preferredCurrency
  };
}

function extractJsonLdEventPriceInfo($) {
  const amountCandidates = [];
  const textValues = [];
  let foundFreeOffer = false;

  function inspectOffer(offer, inheritedCurrency = "EUR") {
    if (!offer) return;

    if (Array.isArray(offer)) {
      offer.forEach(item => inspectOffer(item, inheritedCurrency));
      return;
    }

    if (typeof offer !== "object") return;

    const currency =
      cleanText(
        offer.priceCurrency ||
        offer.currency ||
        inheritedCurrency ||
        "EUR"
      ).toUpperCase() || "EUR";

    [
      offer.price,
      offer.lowPrice,
      offer.highPrice,
      offer.minPrice,
      offer.maxPrice
    ].forEach(value => {
      const amount = parseMoneyNumber(value);

      if (amount !== null) {
        amountCandidates.push({ amount, currency });
        if (amount === 0) foundFreeOffer = true;
      }
    });

    if (offer.priceSpecification) {
      inspectOffer(offer.priceSpecification, currency);
    }

    if (offer.offers) {
      inspectOffer(offer.offers, currency);
    }

    if (offer.description) {
      textValues.push(String(offer.description));
    }

    if (offer.name) {
      textValues.push(String(offer.name));
    }
  }

  function inspectNode(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(inspectNode);
      return;
    }

    if (typeof value !== "object") return;

    const rawTypes = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];

    const isEvent = rawTypes
      .filter(Boolean)
      .some(type => /event$/i.test(String(type)));

    if (isEvent && value.offers) {
      inspectOffer(value.offers, value.priceCurrency || "EUR");
    }

    Object.values(value).forEach(child => {
      if (child && typeof child === "object") {
        inspectNode(child);
      }
    });
  }

  $('script[type="application/ld+json"]').each((index, script) => {
    const raw = $(script).html();

    if (!raw) return;

    try {
      inspectNode(JSON.parse(raw));
    } catch {
      // Ignore malformed structured event data.
    }
  });

  const result = buildPriceInfoFromAmounts(amountCandidates, {
    source: "booking-page",
    confidence: "high",
    textValues,
    forceFree: foundFreeOffer
  });

  return result.priceType === "unknown" ? null : result;
}

function extractExplicitTicketPriceInfo($) {
  const amountCandidates = [];
  const textValues = [];
  let freeTicketTextFound = false;
  let strongestConfidence = "none";

  const ticketContainers = $(
    [
      ".tribe-tickets__tickets-form",
      ".tribe-tickets__tickets-item",
      ".event-tickets",
      ".ticket-widget",
      ".ticketing",
      ".tickets",
      "[id*='ticket']",
      "[class*='ticket']",
      ".woocommerce form.cart",
      ".woocommerce div.product"
    ].join(",")
  );

  const scopedRoot = ticketContainers.length > 0
    ? ticketContainers
    : $(
        [
          ".event-content",
          ".event-description",
          ".tribe-events-single",
          ".entry-content",
          "main article",
          "article"
        ].join(",")
      );

  const explicitPriceSelectors = [
    "[itemprop='price']",
    "[data-price]",
    "[data-ticket-price]",
    ".tribe-tickets__tickets-sale-price",
    ".tribe-tickets__tickets-item-extra-price",
    ".tribe-formatted-currency-wrap",
    ".woocommerce-Price-amount",
    ".ticket-price",
    ".tickets-price",
    ".event-price",
    ".price"
  ];

  scopedRoot
    .find(explicitPriceSelectors.join(","))
    .addBack(explicitPriceSelectors.join(","))
    .each((index, element) => {
      const node = $(element);
      const values = [
        node.attr("content"),
        node.attr("data-price"),
        node.attr("data-ticket-price"),
        node.text()
      ].filter(Boolean);

      values.forEach(value => {
        const textValue = cleanText(value);

        if (!textValue || textValue.length > 250) return;

        textValues.push(textValue);
        extractMoneyAmounts(textValue).forEach(item => amountCandidates.push(item));

        if (/\bfree\b/i.test(textValue)) {
          freeTicketTextFound = true;
        }
      });

      strongestConfidence = "high";
    });

  scopedRoot
    .find("p, li, span, strong, div")
    .addBack("p, li, span, strong, div")
    .each((index, element) => {
      const textValue = cleanText($(element).text());

      if (!textValue || textValue.length > 180) return;

      const hasTicketContext =
        /\b(ticket|tickets|admission|entry|price|from|early bird|general admission|door)\b/i.test(
          textValue
        );

      if (!hasTicketContext) return;

      const amounts = extractMoneyAmounts(textValue);

      if (amounts.length > 0) {
        textValues.push(textValue);
        amounts.forEach(item => amountCandidates.push(item));

        if (strongestConfidence === "none") {
          strongestConfidence = ticketContainers.length > 0 ? "high" : "medium";
        }
      }

      if (/\bfree(?:\s+entry|\s+admission|\s+tickets?)?\b/i.test(textValue)) {
        freeTicketTextFound = true;

        if (strongestConfidence === "none") {
          strongestConfidence = ticketContainers.length > 0 ? "high" : "medium";
        }
      }
    });

  const result = buildPriceInfoFromAmounts(amountCandidates, {
    source: "booking-page",
    confidence: strongestConfidence === "none" ? "medium" : strongestConfidence,
    textValues,
    forceFree: freeTicketTextFound
  });

  return result.priceType === "unknown" ? null : result;
}

function extractPagePriceInfo($) {
  return (
    extractJsonLdEventPriceInfo($) ||
    extractExplicitTicketPriceInfo($) ||
    createUnknownPriceInfo()
  );
}

function getListingPriceInfo(event) {
  const listingText = cleanText(event?.price || "");
  const listingType = event?.priceType || "unknown";

  if (listingType === "free" || /\bfree\b/i.test(listingText)) {
    return {
      priceType: "free",
      priceLabel: "Free",
      priceSource: "corkgigs",
      priceNote: "",
      priceConfidence: "medium",
      minPrice: 0,
      maxPrice: 0,
      currency: "EUR"
    };
  }

  const amounts = extractMoneyAmounts(listingText);

  if (amounts.length > 0) {
    const result = buildPriceInfoFromAmounts(amounts, {
      source: "corkgigs",
      confidence: "medium",
      textValues: [listingText]
    });

    if (result.priceType !== "unknown") {
      return result;
    }
  }

  if (listingType === "paid") {
    return {
      priceType: "paid",
      priceLabel: listingText || "Ticketed event",
      priceSource: "corkgigs",
      priceNote: "",
      priceConfidence: "low",
      minPrice: null,
      maxPrice: null,
      currency: "EUR"
    };
  }

  return createUnknownPriceInfo();
}

function getEventbritePriceInfoForDisplay(eventbriteEvent) {
  if (!eventbriteEvent) {
    return createUnknownPriceInfo();
  }

  const label = cleanText(eventbriteEvent.priceLabel || "");
  const amounts = extractMoneyAmounts(label);

  if (eventbriteEvent.priceType === "free") {
    return {
      priceType: "free",
      priceLabel: "Free",
      priceSource: "eventbrite-api",
      priceNote: "",
      priceConfidence: "high",
      minPrice: 0,
      maxPrice: 0,
      currency: "EUR"
    };
  }

  if (amounts.length > 0) {
    const result = buildPriceInfoFromAmounts(amounts, {
      source: "eventbrite-api",
      confidence: "high",
      textValues: [label]
    });

    if (result.priceType !== "unknown") {
      if (/[-–]/.test(label) && result.maxPrice > result.minPrice) {
        result.priceLabel = `From ${formatCurrencyAmount(
          result.minPrice,
          result.currency
        )}`;
      }

      return result;
    }
  }

  if (eventbriteEvent.priceType === "paid") {
    return {
      priceType: "paid",
      priceLabel: label || "Ticketed event",
      priceSource: "eventbrite-api",
      priceNote: "",
      priceConfidence: "high",
      minPrice: null,
      maxPrice: null,
      currency: "EUR"
    };
  }

  return createUnknownPriceInfo();
}

function chooseBestPriceInfo(...priceCandidates) {
  const priority = {
    "booking-page": 400,
    "event-page": 350,
    "eventbrite-api": 300,
    corkgigs: 200,
    unknown: 0
  };

  const confidence = {
    high: 30,
    medium: 20,
    low: 10,
    none: 0
  };

  const candidates = priceCandidates
    .flat()
    .filter(candidate => candidate && candidate.priceType !== "unknown")
    .map((candidate, index) => ({
      ...candidate,
      index,
      score:
        (priority[candidate.priceSource] || 0) +
        (confidence[candidate.priceConfidence] || 0)
    }))
    .sort((first, second) => {
      if (second.score !== first.score) {
        return second.score - first.score;
      }

      return first.index - second.index;
    });

  return candidates[0] || createUnknownPriceInfo();
}

function addPriceComparisonNote(selectedPrice, listingPrice) {
  if (
    !selectedPrice ||
    !listingPrice ||
    selectedPrice.priceType !== "paid" ||
    listingPrice.priceType !== "paid" ||
    !Number.isFinite(selectedPrice.minPrice) ||
    !Number.isFinite(listingPrice.minPrice) ||
    selectedPrice.priceSource === "corkgigs"
  ) {
    return selectedPrice;
  }

  const difference = Math.abs(
    Number(selectedPrice.minPrice) - Number(listingPrice.minPrice)
  );

  if (difference < 0.01) {
    return selectedPrice;
  }

  const listingLabel =
    listingPrice.priceLabel ||
    formatCurrencyAmount(listingPrice.minPrice, listingPrice.currency);

  const comparisonNote =
    `CorkGigs lists ${listingLabel}; the booking source currently ` +
    `shows ${selectedPrice.priceLabel}.`;

  return {
    ...selectedPrice,
    priceNote: [selectedPrice.priceNote, comparisonNote]
      .filter(Boolean)
      .join(" ")
  };
}

async function scrapeBookingPriceMetadata(bookingUrl) {
  if (
    !bookingUrl ||
    isBlockedUtilityUrl(bookingUrl) ||
    isGenericTicketUrl(bookingUrl)
  ) {
    return createUnknownPriceInfo();
  }

  const cacheKey = stripUrlFragment(bookingUrl);
  const cached = bookingPriceCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.time < BOOKING_PRICE_CACHE_TIME) {
    return cached.data;
  }

  try {
    const response = await axios.get(bookingUrl, {
      httpsAgent,
      timeout: 12000,
      maxRedirects: 8,
      headers: {
        "User-Agent": "Mozilla/5.0 VibeLee Student Project",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    const finalUrl =
      response.request?.res?.responseUrl ||
      response.request?._redirectable?._currentUrl ||
      bookingUrl;
    const contentType = String(response.headers?.["content-type"] || "");

    if (!contentType.includes("html") && typeof response.data !== "string") {
      throw new Error("The booking response was not an HTML page");
    }

    const $ = cheerio.load(response.data);
    const data = extractPagePriceInfo($);

    if (data.priceType !== "unknown") {
      data.priceSource = "booking-page";
      data.bookingPageUrl = finalUrl;
    }

    bookingPriceCache.set(cacheKey, {
      time: now,
      data
    });

    return data;
  } catch (error) {
    console.log(
      `Could not read booking price from ${bookingUrl}: ${error.message}`
    );

    const data = createUnknownPriceInfo();

    bookingPriceCache.set(cacheKey, {
      time: now,
      data
    });

    return data;
  }
}

function formatEventbriteMoney(money) {
  if (!money) return "";

  if (typeof money === "string") {
    return cleanText(money);
  }

  if (money.display) {
    return cleanText(money.display);
  }

  const currency = cleanText(money.currency || "EUR");
  const majorValue = money.major_value;

  if (majorValue !== undefined && majorValue !== null && majorValue !== "") {
    return `${currency} ${majorValue}`;
  }

  const minorValue = Number(money.value);

  if (Number.isFinite(minorValue)) {
    return `${currency} ${(minorValue / 100).toFixed(2)}`;
  }

  return "";
}

function getEventbritePriceInfo(eventbriteEvent) {
  if (!eventbriteEvent) {
    return {
      priceType: "unknown",
      priceLabel: "Price not confirmed",
      isSoldOut: false
    };
  }

  if (eventbriteEvent.is_free === true) {
    return {
      priceType: "free",
      priceLabel: "Free",
      isSoldOut: false
    };
  }

  const availability = eventbriteEvent.ticket_availability || {};
  const minimum = formatEventbriteMoney(
    availability.minimum_ticket_price || availability.minimum_price
  );
  const maximum = formatEventbriteMoney(
    availability.maximum_ticket_price || availability.maximum_price
  );
  const isSoldOut = availability.is_sold_out === true;

  if (minimum && maximum && minimum !== maximum) {
    return {
      priceType: "paid",
      priceLabel: `${minimum} – ${maximum}`,
      isSoldOut
    };
  }

  if (minimum || maximum) {
    return {
      priceType: "paid",
      priceLabel: minimum || maximum,
      isSoldOut
    };
  }

  if (isSoldOut) {
    return {
      priceType: "paid",
      priceLabel: "Sold out",
      isSoldOut: true
    };
  }

  if (eventbriteEvent.is_free === false) {
    return {
      priceType: "paid",
      priceLabel: "Ticketed event",
      isSoldOut
    };
  }

  return {
    priceType: "unknown",
    priceLabel: "Price not confirmed",
    isSoldOut
  };
}

function normaliseEventbriteEvent(eventbriteEvent, eventbriteId) {
  const price = getEventbritePriceInfo(eventbriteEvent);

  return {
    id: eventbriteId,
    title: cleanText(eventbriteEvent?.name?.text || ""),
    description: cleanText(
      eventbriteEvent?.description?.text || eventbriteEvent?.summary || ""
    ),
    imageUrl:
      eventbriteEvent?.logo?.original?.url ||
      eventbriteEvent?.logo?.url ||
      "",
    url: eventbriteEvent?.url || "",
    venue: eventbriteEvent?.venue || null,
    organizer: eventbriteEvent?.organizer || null,
    start: eventbriteEvent?.start || null,
    end: eventbriteEvent?.end || null,
    priceType: price.priceType,
    priceLabel: price.priceLabel,
    isSoldOut: price.isSoldOut
  };
}

async function fetchEventbriteEvent(eventbriteId) {
  if (!EVENTBRITE_TOKEN || !eventbriteId) return null;

  const cached = eventbriteEventCache.get(eventbriteId);
  const now = Date.now();

  if (cached && now - cached.time < EVENTBRITE_CACHE_TIME) {
    return cached.data;
  }

  try {
    const response = await axios.get(
      `${EVENTBRITE_BASE_URL}/events/${eventbriteId}/`,
      {
        params: {
          expand: "venue,organizer,ticket_availability"
        },
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
          Accept: "application/json"
        }
      }
    );

    const data = normaliseEventbriteEvent(response.data, eventbriteId);
    eventbriteFetchErrors.delete(eventbriteId);

    eventbriteEventCache.set(eventbriteId, {
      time: now,
      data
    });

    return data;
  } catch (error) {
    const status = error.response?.status;
    const description =
      error.response?.data?.error_description ||
      error.response?.data?.error ||
      error.message;

    console.log(
      `Could not fetch Eventbrite event ${eventbriteId}` +
      `${status ? ` (${status})` : ""}: ${description}`
    );

    eventbriteFetchErrors.set(eventbriteId, {
      status: status || null,
      message: description
    });

    eventbriteEventCache.set(eventbriteId, {
      time: now,
      data: null
    });

    return null;
  }
}

async function resolveEventbriteReference(event) {
  let eventbriteUrl =
    extractEventbriteUrlsFromValue(event.eventbriteUrl || "", CORKGIGS_URL)[0] ||
    extractEventbriteUrlsFromValue(event.url || "", CORKGIGS_URL)[0] ||
    "";
  let pageMetadata = null;

  if (!eventbriteUrl && isUsefulPageUrl(event.url)) {
    pageMetadata = await scrapePageMetadata(event.url);
    eventbriteUrl =
      pageMetadata.eventbriteUrl ||
      extractEventbriteUrlsFromValue(pageMetadata.ticketUrl || "", event.url)[0] ||
      "";
  }

  return {
    eventbriteUrl,
    eventbriteId: extractEventbriteEventId(eventbriteUrl),
    pageMetadata
  };
}

async function findEventbriteMatchForEvent(event) {
  const cached = eventbriteMatchCache.get(event.id);
  const now = Date.now();

  if (cached && now - cached.time < EVENTBRITE_CACHE_TIME) {
    return cached.data;
  }

  const reference = await resolveEventbriteReference(event);

  if (!reference.eventbriteId) {
    eventbriteMatchCache.set(event.id, {
      time: now,
      data: null
    });

    return null;
  }

  const eventbriteEvent = await fetchEventbriteEvent(reference.eventbriteId);

  const match = eventbriteEvent
    ? {
        ...reference,
        eventbriteEvent
      }
    : null;

  eventbriteMatchCache.set(event.id, {
    time: now,
    data: match
  });

  return match;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, Math.max(items.length, 1)) },
      () => runWorker()
    )
  );

  return results;
}

async function scrapePageMetadata(pageUrl) {
  const emptyMetadata = {
    description: "",
    imageUrl: "",
    ticketUrl: "",
    ticketConfidence: "none",
    ticketReason: "",
    ticketSource: "",
    hasEmbeddedTickets: false,
    ticketCandidates: [],
    eventbriteUrl: "",
    priceInfo: createUnknownPriceInfo(),
    finalUrl: pageUrl
  };

  if (!isUsefulPageUrl(pageUrl)) {
    return emptyMetadata;
  }

  const cached = pageMetadataCache.get(pageUrl);
  const now = Date.now();

  if (cached && now - cached.time < PAGE_METADATA_CACHE_TIME) {
    return cached.data;
  }

  try {
    const response = await axios.get(pageUrl, {
      httpsAgent,
      timeout: 10000,
      maxRedirects: 8,
      headers: {
        "User-Agent": "Mozilla/5.0 VibeLee Student Project"
      }
    });

    const finalUrl =
      response.request?.res?.responseUrl ||
      response.request?._redirectable?._currentUrl ||
      pageUrl;
    const $ = cheerio.load(response.data);
    const eventbriteUrl =
      extractEventbriteUrlsFromValue(finalUrl, pageUrl)[0] ||
      chooseEventbriteLink($, finalUrl);
    const ticketTarget = chooseTicketTarget($, finalUrl);
    const data = {
      description: choosePageDescription($),
      imageUrl: choosePageImage($, finalUrl),
      ticketUrl: eventbriteUrl || ticketTarget.url,
      ticketConfidence: eventbriteUrl ? "high" : ticketTarget.confidence,
      ticketReason: eventbriteUrl
        ? "Eventbrite event URL"
        : ticketTarget.reason,
      ticketSource: eventbriteUrl
        ? "eventbrite"
        : ticketTarget.source,
      hasEmbeddedTickets: ticketTarget.hasEmbeddedTickets,
      ticketCandidates: ticketTarget.candidates,
      eventbriteUrl,
      priceInfo: extractPagePriceInfo($),
      finalUrl
    };

    pageMetadataCache.set(pageUrl, {
      time: now,
      data
    });

    return data;
  } catch (error) {
    console.log(`Could not enrich page ${pageUrl}: ${error.message}`);

    pageMetadataCache.set(pageUrl, {
      time: now,
      data: emptyMetadata
    });

    return emptyMetadata;
  }
}

function createFallbackDescription(event) {
  const timeText = event.time ? ` at ${event.time}` : "";
  const priceText = event.price
    ? ` Listed price information: ${event.price}.`
    : " Price information has not yet been confirmed.";

  return `${event.title} is listed at ${event.venue} on ${event.date}${timeText}.` +
    `${priceText} Open the original listing for the latest scheduling and ticket information.`;
}

async function getDetailedEvent(event, allEvents) {
  const cached = eventDetailCache.get(event.id);
  const now = Date.now();

  if (cached && now - cached.time < EVENT_DETAIL_CACHE_TIME) {
    return cached.data;
  }

  const eventMetadata = await scrapePageMetadata(event.eventInfoUrl || event.url);
  const venueMetadata = eventMetadata.imageUrl
    ? {
        description: "",
        imageUrl: "",
        ticketUrl: "",
        eventbriteUrl: "",
        ticketConfidence: "none",
        ticketReason: "",
        ticketSource: "",
        hasEmbeddedTickets: false,
        ticketCandidates: [],
        priceInfo: createUnknownPriceInfo()
      }
    : await scrapePageMetadata(event.venueUrl);
  const eventbriteMatch = await findEventbriteMatchForEvent(event);
  const eventbriteEvent = eventbriteMatch?.eventbriteEvent || null;

  const relatedEvents = allEvents
    .filter(candidate =>
      candidate.id !== event.id &&
      normalizeVenueKey(candidate.venue) === normalizeVenueKey(event.venue)
    )
    .slice(0, 4);

  // Never use a ticket URL scraped from a generic venue page. Venue pages
  // often contain restaurant reservations, calendars, maps, transport or
  // an all-events shop. Only the event-specific page, the CorkGigs ticket
  // link, or a verified provider event URL may become the booking target.
  const selectedTicketUrl = chooseBestTicketUrl(
    eventbriteEvent?.url,
    eventMetadata.ticketUrl,
    event.ticketUrl
  );

  const eventPagePriceInfo =
    eventMetadata.priceInfo?.priceType !== "unknown"
      ? {
          ...eventMetadata.priceInfo,
          priceSource:
            eventMetadata.hasEmbeddedTickets ||
            (
              selectedTicketUrl &&
              stripUrlFragment(selectedTicketUrl) ===
                stripUrlFragment(eventMetadata.finalUrl)
            )
              ? "booking-page"
              : "event-page"
        }
      : createUnknownPriceInfo();

  let bookingPagePriceInfo = createUnknownPriceInfo();

  if (selectedTicketUrl) {
    const selectedTicketIsEventPage =
      stripUrlFragment(selectedTicketUrl) ===
      stripUrlFragment(eventMetadata.finalUrl);

    bookingPagePriceInfo = selectedTicketIsEventPage
      ? {
          ...eventPagePriceInfo,
          priceSource: "booking-page"
        }
      : await scrapeBookingPriceMetadata(selectedTicketUrl);
  }

  const eventbritePriceInfo =
    getEventbritePriceInfoForDisplay(eventbriteEvent);
  const listingPriceInfo = getListingPriceInfo(event);

  let selectedPriceInfo = chooseBestPriceInfo(
    bookingPagePriceInfo,
    eventPagePriceInfo,
    eventbritePriceInfo,
    listingPriceInfo
  );

  selectedPriceInfo = addPriceComparisonNote(
    selectedPriceInfo,
    listingPriceInfo
  );

  const detailedEvent = {
    ...event,
    source: eventbriteEvent ? "CorkGigs + Eventbrite" : event.source,
    description:
      eventbriteEvent?.description ||
      eventMetadata.description ||
      venueMetadata.description ||
      createFallbackDescription(event),
    imageUrl:
      eventbriteEvent?.imageUrl ||
      eventMetadata.imageUrl ||
      venueMetadata.imageUrl ||
      "",
    ticketUrl: selectedTicketUrl,
    ticketConfidence: eventbriteEvent
      ? "high"
      : eventMetadata.ticketConfidence || "none",
    ticketReason: eventbriteEvent
      ? "Verified Eventbrite event"
      : eventMetadata.ticketReason || "",
    ticketSource: eventbriteEvent
      ? "eventbrite"
      : eventMetadata.ticketSource || "",
    relatedEvents,
    priceType: selectedPriceInfo.priceType,
    priceLabel: selectedPriceInfo.priceLabel,
    priceSource: selectedPriceInfo.priceSource,
    priceNote: selectedPriceInfo.priceNote,
    priceConfidence: selectedPriceInfo.priceConfidence,
    priceMin: selectedPriceInfo.minPrice,
    priceMax: selectedPriceInfo.maxPrice,
    priceCurrency: selectedPriceInfo.currency,
    listingPrice: listingPriceInfo.priceLabel,
    eventbriteVerified: Boolean(eventbriteEvent),
    eventbriteId: eventbriteMatch?.eventbriteId || "",
    eventbriteUrl: eventbriteMatch?.eventbriteUrl || "",
    eventbriteVenue: eventbriteEvent?.venue || null,
    eventbriteOrganizer: eventbriteEvent?.organizer || null,
    isSoldOut: eventbriteEvent?.isSoldOut || false
  };

  eventDetailCache.set(event.id, {
    time: now,
    data: detailedEvent
  });

  return detailedEvent;
}


async function getEventPreview(event) {
  const cached = eventPreviewCache.get(event.id);
  const now = Date.now();

  if (cached && now - cached.time < EVENT_PREVIEW_CACHE_TIME) {
    return cached.data;
  }

  const primaryPageUrl = event.eventInfoUrl || event.url || "";
  const eventbritePromise = event.eventbriteId
    ? fetchEventbriteEvent(event.eventbriteId)
    : Promise.resolve(null);
  const primaryMetadataPromise = isUsefulPageUrl(primaryPageUrl)
    ? scrapePageMetadata(primaryPageUrl)
    : Promise.resolve(null);

  const [eventbriteEvent, primaryMetadata] = await Promise.all([
    eventbritePromise,
    primaryMetadataPromise
  ]);

  let imageUrl = eventbriteEvent?.imageUrl || primaryMetadata?.imageUrl || "";
  let imageSource = eventbriteEvent?.imageUrl
    ? "eventbrite"
    : primaryMetadata?.imageUrl
      ? "event-page"
      : "";

  const secondaryPageUrls = [
    event.ticketUrl,
    event.url
  ]
    .filter(Boolean)
    .filter(url => isUsefulPageUrl(url))
    .filter(url => stripUrlFragment(url) !== stripUrlFragment(primaryPageUrl));

  for (const pageUrl of secondaryPageUrls) {
    if (imageUrl) break;

    const metadata = await scrapePageMetadata(pageUrl);

    if (metadata.imageUrl) {
      imageUrl = metadata.imageUrl;
      imageSource = "booking-page";
    }
  }

  const preview = {
    eventId: event.id,
    title: event.title,
    venue: event.venue,
    imageUrl,
    imageSource,
    hasImage: Boolean(imageUrl)
  };

  eventPreviewCache.set(event.id, {
    time: now,
    data: preview
  });

  return preview;
}

function slugifyVenue(venueName) {
  return venueName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasValidCoordinates(data) {
  return (
    data &&
    data.coordinates &&
    typeof data.coordinates.lat === "number" &&
    typeof data.coordinates.lng === "number" &&
    !Number.isNaN(data.coordinates.lat) &&
    !Number.isNaN(data.coordinates.lng)
  );
}

function getVenueOverride(venueName) {
  const cacheKey = normalizeVenueKey(venueName);
  const apostropheFreeKey = cacheKey.replace(/['’]/g, "");

  return venueOverrides[cacheKey] || venueOverrides[apostropheFreeKey] || null;
}

function looksLikeGoodGeocodeResult(result, venueName, query) {
  const displayName = (result.display_name || "").toLowerCase();
  const venue = venueName.toLowerCase();
  const searchQuery = query.toLowerCase();

  if (!displayName.includes("ireland")) {
    return false;
  }

  if (!displayName.includes("cork")) {
    return false;
  }

  const lat = parseFloat(result.lat);
  const lng = parseFloat(result.lon);

  const corkCityCentreLat = 51.8985;
  const corkCityCentreLng = -8.4756;

  const veryCloseToGenericCorkCentre =
    Math.abs(lat - corkCityCentreLat) < 0.003 &&
    Math.abs(lng - corkCityCentreLng) < 0.003;

  const resultLooksGeneric =
    displayName.startsWith("cork,") ||
    displayName.includes("city centre") ||
    displayName === "cork, county cork, munster, ireland";

  if (veryCloseToGenericCorkCentre && resultLooksGeneric) {
    return false;
  }

  const importantWords = venue
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 4)
    .filter(word => !["cork", "ireland", "venue", "theatre", "music"].includes(word));

  const commaParts = venueName.split(",").map(part => part.trim().toLowerCase());

  if (commaParts.length > 1) {
    const townPart = commaParts[commaParts.length - 1];

    if (townPart.length >= 4 && !displayName.includes(townPart)) {
      return false;
    }
  }

  const hasMatchingWord = importantWords.some(word => {
    return displayName.includes(word) || searchQuery.includes(word);
  });

  return hasMatchingWord;
}

function extractAddressFromVenuePage(html, venueName) {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());

  let usefulText = bodyText;

  const phoneIndex = usefulText.search(/phone:/i);
  if (phoneIndex !== -1) {
    usefulText = usefulText.slice(0, phoneIndex);
  }

  let address = usefulText
    .replace(new RegExp(escapeRegExp(venueName), "i"), "")
    .replace(/venue profiles?/i, "")
    .replace(/corkgigs\.com/i, "")
    .replace(/home/i, "")
    .replace(/venues?/i, "")
    .trim();

  const corkIndex = address.toLowerCase().indexOf("cork");

  if (corkIndex !== -1) {
    address = address.slice(0, corkIndex + 4);
  }

  address = cleanText(address);

  if (!address || address.length < 4) {
    return `${venueName}, Cork, Ireland`;
  }

  if (!address.toLowerCase().includes("ireland")) {
    address = `${address}, Ireland`;
  }

  return address;
}

async function geocodeAddress(address, venueName) {
  const queries = [
    `${venueName}, Cork, Ireland`,
    address,
    `${venueName}, County Cork, Ireland`
  ].filter(Boolean);

  for (const query of queries) {
    console.log(`Geocoding: ${query}`);

    await sleep(1100);

    try {
      const response = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: {
          q: query,
          format: "json",
          limit: 5,
          countrycodes: "ie",
          addressdetails: 1
        },
        headers: {
          "User-Agent": "cork-gigs-maplibre-student-project/1.0"
        }
      });

      if (!response.data || response.data.length === 0) {
        continue;
      }

      const goodResult = response.data.find(result => {
        return looksLikeGoodGeocodeResult(result, venueName, query);
      });

      if (!goodResult) {
        console.log(`No reliable geocode result for: ${venueName}`);
        continue;
      }

      return {
        lat: parseFloat(goodResult.lat),
        lng: parseFloat(goodResult.lon)
      };
    } catch (error) {
      console.log(`Geocoding failed for ${venueName}:`, error.message);
    }
  }

  return null;
}

async function getVenueCoordinatesFromCorkGigs(venueName, venueUrl) {
  if (!venueName || venueName === "Venue not listed") {
    return {
      venue: venueName,
      address: "",
      coordinates: null,
      source: "not found"
    };
  }

  const cacheKey = normalizeVenueKey(venueName);

  // 1. Always check manual overrides first
  const override = getVenueOverride(venueName);

  if (override) {
    const overrideData = {
      venue: venueName,
      address: `${venueName}, Cork, Ireland`,
      coordinates: {
        lat: Number(override.lat),
        lng: Number(override.lng)
      },
      source: "venue-overrides.json"
    };

    venueCache[cacheKey] = overrideData;
    saveVenueCache();

    return overrideData;
  }

  // 2. Reuse both successful and failed cached results.
  // This prevents slow, repeated geocoding on every page request.
  if (Object.prototype.hasOwnProperty.call(venueCache, cacheKey)) {
    return venueCache[cacheKey];
  }

  // 3. A venue that has never been cached is geocoded once.
  console.log(`Finding coordinates for venue: ${venueName}`);

  const possibleVenueUrls = [];

  if (venueUrl) {
    possibleVenueUrls.push(venueUrl);
  }

  possibleVenueUrls.push(
    `https://www.corkgigs.com/venue/${slugifyVenue(venueName)}`
  );

  let finalVenueData = {
    venue: venueName,
    address: `${venueName}, Cork, Ireland`,
    coordinates: null,
    source: "not found"
  };

  for (const url of possibleVenueUrls) {
    try {
      const response = await axios.get(url, {
        httpsAgent,
        headers: {
          "User-Agent": "Mozilla/5.0 Student Project Venue Scraper"
        }
      });

      const html = response.data;
      const address = extractAddressFromVenuePage(html, venueName);

      const coordinates = await geocodeAddress(address, venueName);

      if (coordinates) {
        finalVenueData = {
          venue: venueName,
          address,
          coordinates,
          source: url
        };

        break;
      }
    } catch (error) {
      console.log(`Could not read venue page ${url}: ${error.message}`);
    }
  }

  venueCache[cacheKey] = finalVenueData;
  saveVenueCache();

  return finalVenueData;
}

async function attachCoordinatesToEvents(events) {
  const uniqueVenues = new Map();

  events.forEach(event => {
    const key = normalizeVenueKey(event.venue);

    if (!uniqueVenues.has(key)) {
      uniqueVenues.set(key, {
        venueName: event.venue,
        venueUrl: event.venueUrl
      });
    }
  });

  for (const venueInfo of uniqueVenues.values()) {
    await getVenueCoordinatesFromCorkGigs(
      venueInfo.venueName,
      venueInfo.venueUrl
    );
  }

  return events.map(event => {
    const cacheKey = normalizeVenueKey(event.venue);
    const venueData = venueCache[cacheKey];

    return {
      ...event,
      coordinates: venueData ? venueData.coordinates : null,
      venueAddress: venueData ? venueData.address : ""
    };
  });
}

function extractEventbriteId(url = "") {
  if (!url || !/eventbrite\.(ie|com|co\.uk)/i.test(url)) {
    return "";
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    const match =
      decodedUrl.match(/\/e\/[^?#]*?-(\d{8,})(?:[/?#]|$)/i) ||
      decodedUrl.match(/\/events\/(\d{8,})(?:[/?#]|$)/i);

    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function getListingPriceType(priceText, ticketUrl = "") {
  const price = cleanText(priceText).toLowerCase();

  if (
    price.includes("free") ||
    /€\s*0(?:\.00)?\b/.test(price)
  ) {
    return "free";
  }

  if (
    ticketUrl ||
    /€\s*\d/.test(price) ||
    /eur\s*\d/.test(price)
  ) {
    return "paid";
  }

  return "unknown";
}

function createEventId(date, time, title, venue) {
  return `${date}-${time}-${title}-${venue}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function parseCorkGigs(html) {
  const $ = cheerio.load(html);
  const events = [];

  $("tr.event").each((index, row) => {
    const cells = $(row).find("td");

    if (cells.length < 5) {
      return;
    }

    const date = cleanText(cells.eq(0).text());
    const time = cleanText(cells.eq(1).text());

    const titleCell = cells.eq(2);
    const venueCell = cells.eq(3);

    const title = cleanText(
      titleCell.clone().find("a, img").remove().end().text()
    );

    const venue = cleanText(
      venueCell.clone().find("a, img").remove().end().text()
    );

    const price = cleanText(cells.eq(4).text());

    if (!date || !title || !venue) {
      return;
    }

    const titleLinks = titleCell
      .find("a")
      .map((linkIndex, link) => {
        const element = $(link);
        const href = makeAbsoluteUrl(element.attr("href"));
        const imageAlt = cleanText(element.find("img").attr("alt"));
        const imageTitle = cleanText(element.find("img").attr("title"));
        const anchorText = cleanText(element.text());
        const anchorTitle = cleanText(element.attr("title"));
        const description = [
          anchorText,
          anchorTitle,
          imageAlt,
          imageTitle,
          href
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return {
          href,
          description,
          linkIndex
        };
      })
      .get();

    const ticketLinkData = titleLinks
      .filter(link => !isBlockedUtilityUrl(link.href))
      .map(link => {
        const lowerUrl = link.href.toLowerCase();
        const strongTicketLabel = hasStrongTicketText(link.description);
        const generalTicketLabel = hasGeneralTicketText(link.description);
        const negativeContext = isNonTicketBookingText(link.description);

        let score = scoreTicketUrl(link.href);

        if (strongTicketLabel) score += 220;
        else if (generalTicketLabel) score += 90;

        if (isIndividualProviderEventUrl(link.href)) score += 220;
        else if (isTrustedTicketProvider(link.href)) score += 120;

        if (/eventbrite\.(ie|com|co\.uk)/i.test(lowerUrl)) score += 80;
        if (negativeContext) score -= 700;

        return { ...link, score };
      })
      .filter(link => link.score >= 150)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score;
        }

        return first.linkIndex - second.linkIndex;
      })[0];

    const eventInfoLinkData = titleLinks.find(link => {
      return (
        link.linkIndex !== ticketLinkData?.linkIndex &&
        !isBlockedUtilityUrl(link.href) &&
        !isTrustedTicketProvider(link.href) &&
        !hasStrongTicketText(link.description) &&
        !hasGeneralTicketText(link.description)
      );
    });

    const venueLink = venueCell.find("a").first().attr("href");

    const ticketUrl = ticketLinkData?.href || "";
    const eventInfoUrl = eventInfoLinkData?.href || "";
    const venueUrl = venueLink ? makeAbsoluteUrl(venueLink) : "";
    const eventbriteUrl = /eventbrite\.(ie|com|co\.uk)/i.test(ticketUrl)
      ? ticketUrl
      : "";
    const eventbriteId = extractEventbriteId(eventbriteUrl);
    const priceType = getListingPriceType(price, ticketUrl);
    const categoryInfo = classifyEventForDiscover({
      title,
      venue,
      priceType
    });

    events.push({
      id: createEventId(date, time, title, venue),
      date,
      isoDate: parseCorkGigsDateToIso(date),
      time,
      title,
      venue,
      price,
      priceType,
      ...categoryInfo,
      ticketUrl,
      eventbriteUrl,
      eventbriteId,
      eventInfoUrl,
      venueUrl,
      url: eventInfoUrl || ticketUrl || CORKGIGS_URL,
      source: "CorkGigs",
      coordinates: null,
      venueAddress: ""
    });
  });

  const uniqueEvents = [];
  const seen = new Set();

  events.forEach(event => {
    const key = [
      event.date,
      event.time,
      event.title,
      event.venue
    ].join("|").toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      uniqueEvents.push(event);
    }
  });

  return uniqueEvents;
}

async function getCorkGigsEvents() {
  const now = Date.now();

  if (cachedEvents.length > 0 && now - lastFetched < CACHE_TIME) {
    return cachedEvents;
  }

  if (eventsFetchPromise) {
    return eventsFetchPromise;
  }

  eventsFetchPromise = (async () => {
    const response = await axios.get(CORKGIGS_URL, {
      httpsAgent,
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 VibeLee Student Project"
      }
    });

    let events = parseCorkGigs(response.data);
    events = await attachCoordinatesToEvents(events);

    cachedEvents = events;
    lastFetched = Date.now();

    return events;
  })();

  try {
    return await eventsFetchPromise;
  } finally {
    eventsFetchPromise = null;
  }
}

function calculateDistanceKm(pointA, pointB) {
  if (!pointA || !pointB) return null;

  const toRadians = value => (Number(value) * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const deltaLat = toRadians(pointB.lat - pointA.lat);
  const deltaLng = toRadians(pointB.lng - pointA.lng);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) ** 2;

  const angle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusKm * angle;
}

function parseEventTimeToMinutes(timeText) {
  const match = cleanText(timeText).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) return Number.MAX_SAFE_INTEGER;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;

  return hour * 60 + minute;
}

function hashString(value) {
  let hash = 0;

  for (const character of String(value || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function normaliseSurpriseOption(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function classifySurpriseEvent(event) {
  const categoryInfo = Array.isArray(event.categories)
    ? event
    : classifyEventForDiscover(event);
  const categories = new Set(categoryInfo.categories || []);

  if (categories.has("comedy")) {
    return "comedy";
  }

  if (categories.has("trad")) {
    return "trad";
  }

  if (categories.has("nightlife")) {
    return "nightlife";
  }

  return "music";
}

function getSurpriseTypeLabel(type) {
  const labels = {
    any: "anything",
    music: "live music",
    comedy: "comedy",
    nightlife: "DJ and nightlife",
    trad: "traditional music"
  };

  return labels[type] || labels.any;
}

function getSurpriseDistanceLabel(distance) {
  const labels = {
    centre: "within 3 km of Cork city centre",
    nearby: "within 8 km of Cork city centre",
    any: "anywhere in the Cork listings"
  };

  return labels[distance] || labels.nearby;
}

function buildSurpriseReason(event, selectedType, selectedPrice, selectedDistance) {
  if (!event) return "";

  const parts = [];
  const typeLabel = getSurpriseTypeLabel(event.surpriseType);

  parts.push(`a ${typeLabel} pick`);

  if (selectedPrice === "free") {
    parts.push("with a free listing");
  } else if (selectedPrice === "paid") {
    parts.push("with ticket information available");
  } else if (event.priceType === "free") {
    parts.push("that is listed as free");
  } else if (event.priceType === "paid") {
    parts.push("with ticketing available");
  }

  if (event.distanceFromCentreKm !== null) {
    parts.push(`${event.distanceFromCentreKm.toFixed(1)} km from Cork city centre`);
  } else if (selectedDistance === "any") {
    parts.push("from the wider Cork listings");
  }

  const sentence = parts.join(", ");
  return `VibeLee selected ${sentence}.`;
}

async function buildSurprisePlan(events, query) {
  const dateOptions = [...new Set(events.map(event => event.date))];
  const selectedDate = dateOptions.includes(query.date)
    ? query.date
    : dateOptions[0] || "";
  const selectedType = normaliseSurpriseOption(
    query.type || "any",
    SURPRISE_EVENT_TYPES,
    "any"
  );
  const selectedPrice = normaliseSurpriseOption(
    query.price || "any",
    SURPRISE_PRICE_OPTIONS,
    "any"
  );
  const selectedDistance = normaliseSurpriseOption(
    query.distance || "nearby",
    SURPRISE_DISTANCE_OPTIONS,
    "nearby"
  );

  const preparedEvents = events.map(event => ({
    ...event,
    surpriseType: classifySurpriseEvent(event),
    distanceFromCentreKm: event.coordinates
      ? calculateDistanceKm(CORK_CITY_CENTRE, event.coordinates)
      : null
  }));

  const candidates = preparedEvents.filter(event => {
    if (selectedDate && event.date !== selectedDate) return false;
    if (selectedType !== "any" && event.surpriseType !== selectedType) return false;
    if (selectedPrice !== "any" && event.priceType !== selectedPrice) return false;

    if (selectedDistance !== "any") {
      const limit = SURPRISE_DISTANCE_LIMITS[selectedDistance];

      if (event.distanceFromCentreKm === null || event.distanceFromCentreKm > limit) {
        return false;
      }
    }

    return true;
  });

  const requestedEvent = candidates.find(event => event.id === query.event);
  let drawPool = candidates.filter(event => event.id !== query.exclude);

  if (drawPool.length === 0) {
    drawPool = candidates;
  }

  const seed = String(
    query.seed || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const selectionKey = [
    selectedDate,
    selectedType,
    selectedPrice,
    selectedDistance,
    seed
  ].join("|");
  const selectedBaseEvent = requestedEvent || (
    drawPool.length > 0
      ? drawPool[hashString(selectionKey) % drawPool.length]
      : null
  );

  let selectedEvent = null;

  if (selectedBaseEvent) {
    const detailedEvent = await getDetailedEvent(selectedBaseEvent, events);

    selectedEvent = {
      ...detailedEvent,
      surpriseType: selectedBaseEvent.surpriseType,
      surpriseTypeLabel: getSurpriseTypeLabel(selectedBaseEvent.surpriseType),
      distanceFromCentreKm: selectedBaseEvent.distanceFromCentreKm
    };
  }

  const sharedParams = new URLSearchParams();
  if (selectedDate) sharedParams.set("date", selectedDate);
  sharedParams.set("type", selectedType);
  sharedParams.set("price", selectedPrice);
  sharedParams.set("distance", selectedDistance);

  let detailUrl = "";
  let rerollUrl = `/surprise?${sharedParams.toString()}`;

  if (selectedEvent) {
    const detailParams = new URLSearchParams(sharedParams);
    detailParams.set("from", "surprise");
    detailParams.set("event", selectedEvent.id);

    detailUrl = `/events/${encodeURIComponent(selectedEvent.id)}?${detailParams.toString()}`;

    const rerollParams = new URLSearchParams(sharedParams);
    rerollParams.set("exclude", selectedEvent.id);
    rerollParams.set("seed", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    rerollUrl = `/surprise?${rerollParams.toString()}`;
  }

  return {
    dateOptions,
    selectedDate,
    selectedType,
    selectedPrice,
    selectedDistance,
    selectedEvent,
    candidateCount: candidates.length,
    detailUrl,
    rerollUrl,
    selectionReason: buildSurpriseReason(
      selectedEvent,
      selectedType,
      selectedPrice,
      selectedDistance
    ),
    distanceScopeLabel: getSurpriseDistanceLabel(selectedDistance)
  };
}

function normaliseTouristOption(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function getTouristInterestLabel(interest) {
  const labels = {
    balanced: "Balanced Cork",
    food: "Food and streets",
    history: "History and character",
    riverside: "Riverside Cork",
    local: "Local neighbourhoods"
  };

  return labels[interest] || labels.balanced;
}

function getTouristPaceLabel(pace) {
  return TOURIST_PACE_PROFILES[pace]?.label || TOURIST_PACE_PROFILES.standard.label;
}

function getTouristAccessLabel(access) {
  const labels = {
    indoor: "Mostly indoors",
    outdoor: "Outdoor stop",
    mixed: "Indoor and outdoor"
  };

  return labels[access] || labels.outdoor;
}

function getTouristInterestScore(place, interest) {
  const tags = new Set([place.category, ...(place.tags || [])]);

  if (interest === "balanced") {
    return 18;
  }

  const matchingTags = {
    food: ["food", "market", "cafes", "restaurants", "nightlife"],
    history: ["history", "heritage", "architecture", "landmark", "views"],
    riverside: ["river", "riverside", "park", "walk", "docklands"],
    local: ["local", "neighbourhood", "street", "music", "independent"]
  };

  return (matchingTags[interest] || []).reduce((score, tag) => {
    return score + (tags.has(tag) ? 16 : 0);
  }, 0);
}

function getTouristVisitMinutes(place, pace) {
  const profile = TOURIST_PACE_PROFILES[pace] || TOURIST_PACE_PROFILES.standard;
  const rawMinutes = Math.max(15, Number(place.recommendedMinutes || 30));
  const adjusted = Math.round((rawMinutes * profile.visitMultiplier) / 5) * 5;

  return Math.max(15, adjusted);
}

function formatMinutesAsClock(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    return "";
  }

  const normalised = totalMinutes % (24 * 60);
  const hour24 = Math.floor(normalised / 60);
  const minute = normalised % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function chooseTouristPlaces(selectedEvent, selectedDate, interest, pace) {
  if (!selectedEvent?.coordinates || TOURIST_PLACES.length === 0) {
    return [];
  }

  const profile = TOURIST_PACE_PROFILES[pace] || TOURIST_PACE_PROFILES.standard;
  const seed = hashString(`${selectedDate}|${selectedEvent.id}|${interest}|${pace}`);

  const candidates = TOURIST_PLACES
    .map(place => ({
      ...place,
      visitMinutes: getTouristVisitMinutes(place, pace),
      distanceToEventKm: calculateDistanceKm(
        place.coordinates,
        selectedEvent.coordinates
      ),
      distanceFromCentreKm: calculateDistanceKm(
        CORK_CITY_CENTRE,
        place.coordinates
      ),
      interestScore: getTouristInterestScore(place, interest)
    }))
    .filter(place => {
      return (
        place.distanceToEventKm !== null &&
        place.distanceToEventKm <= profile.maxPlaceToEventKm &&
        place.distanceFromCentreKm !== null &&
        place.distanceFromCentreKm <= TOURIST_CITY_RADIUS_KM
      );
    });

  if (candidates.length < 2) {
    return candidates
      .sort((first, second) => first.distanceToEventKm - second.distanceToEventKm)
      .slice(0, 2)
      .sort((first, second) => second.distanceToEventKm - first.distanceToEventKm);
  }

  const pairs = [];

  candidates.forEach(startPlace => {
    candidates.forEach(middlePlace => {
      if (startPlace.id === middlePlace.id) {
        return;
      }

      const firstLegKm = calculateDistanceKm(
        startPlace.coordinates,
        middlePlace.coordinates
      );
      const secondLegKm = calculateDistanceKm(
        middlePlace.coordinates,
        selectedEvent.coordinates
      );

      if (
        firstLegKm === null ||
        secondLegKm === null ||
        firstLegKm < 0.18 ||
        firstLegKm > profile.maxSegmentKm ||
        secondLegKm > profile.maxSegmentKm * 1.35
      ) {
        return;
      }

      const routeKm = firstLegKm + secondLegKm;
      const movingTowardsEvent =
        startPlace.distanceToEventKm >= middlePlace.distanceToEventKm - 0.15;
      const categoryVariety = startPlace.category !== middlePlace.category;
      const eveningScore =
        (startPlace.eveningFriendly ? 10 : -18) +
        (middlePlace.eveningFriendly ? 10 : -18);
      const targetScore = Math.max(
        -40,
        48 - Math.abs(routeKm - profile.targetRouteKm) * 24
      );
      const interestScore = startPlace.interestScore + middlePlace.interestScore;
      const progressScore = movingTowardsEvent ? 28 : -26;
      const varietyScore = categoryVariety ? 18 : interest === "balanced" ? -8 : 2;
      const deterministicTieBreaker =
        hashString(`${seed}|${startPlace.id}|${middlePlace.id}`) % 11;

      pairs.push({
        places: [startPlace, middlePlace],
        score:
          interestScore +
          eveningScore +
          targetScore +
          progressScore +
          varietyScore +
          deterministicTieBreaker,
        routeKm
      });
    });
  });

  if (pairs.length === 0) {
    return candidates
      .sort((first, second) => {
        const scoreDifference = second.interestScore - first.interestScore;
        if (scoreDifference !== 0) return scoreDifference;
        return first.distanceToEventKm - second.distanceToEventKm;
      })
      .slice(0, 2)
      .sort((first, second) => second.distanceToEventKm - first.distanceToEventKm);
  }

  pairs.sort((first, second) => second.score - first.score);
  return pairs[0].places;
}

function buildTouristPlan(events, query = {}) {
  const requestedDate = query.date || "";
  const requestedEventId = query.event || "";
  const selectedInterest = normaliseTouristOption(
    query.interest || "balanced",
    TOURIST_INTEREST_OPTIONS,
    "balanced"
  );
  const selectedPace = normaliseTouristOption(
    query.pace || "standard",
    TOURIST_PACE_OPTIONS,
    "standard"
  );

  const mappedCityEvents = events
    .filter(event => event.coordinates)
    .map(event => ({
      ...event,
      distanceFromCentreKm: calculateDistanceKm(
        CORK_CITY_CENTRE,
        event.coordinates
      )
    }))
    .filter(event => {
      return (
        event.distanceFromCentreKm !== null &&
        event.distanceFromCentreKm <= TOURIST_CITY_RADIUS_KM
      );
    });

  const dateOptions = [...new Set(mappedCityEvents.map(event => event.date))];
  const selectedDate = dateOptions.includes(requestedDate)
    ? requestedDate
    : dateOptions[0] || "";

  const eventsOnDate = mappedCityEvents.filter(event => {
    return !selectedDate || event.date === selectedDate;
  });

  const sortedCandidates = [...eventsOnDate].sort((eventA, eventB) => {
    const timeDifference =
      parseEventTimeToMinutes(eventA.time) -
      parseEventTimeToMinutes(eventB.time);

    if (timeDifference !== 0) return timeDifference;
    if (eventA.ticketUrl && !eventB.ticketUrl) return -1;
    if (!eventA.ticketUrl && eventB.ticketUrl) return 1;

    const distanceDifference =
      (eventA.distanceFromCentreKm ?? 999) -
      (eventB.distanceFromCentreKm ?? 999);

    if (distanceDifference !== 0) return distanceDifference;
    return eventA.title.localeCompare(eventB.title);
  });

  const requestedEvent = sortedCandidates.find(event => {
    return event.id === requestedEventId;
  });

  const selectedEvent = requestedEvent || sortedCandidates[0] || null;
  const alternativeEvents = sortedCandidates
    .filter(event => !selectedEvent || event.id !== selectedEvent.id)
    .slice(0, 6);

  const routeStops = [];
  let attractionVisitMinutes = 0;

  if (selectedEvent) {
    const chosenPlaces = chooseTouristPlaces(
      selectedEvent,
      selectedDate,
      selectedInterest,
      selectedPace
    );

    chosenPlaces.forEach((place, index) => {
      attractionVisitMinutes += place.visitMinutes;

      routeStops.push({
        id: place.id,
        step: String(index + 1).padStart(2, "0"),
        label: index === 0 ? "Start" : "Explore",
        title: place.title,
        category: place.category,
        categoryLabel: place.categoryLabel,
        description: place.description,
        area: place.area,
        accessLabel: getTouristAccessLabel(place.access),
        visitMinutes: place.visitMinutes,
        coordinates: place.coordinates,
        tags: place.tags
      });
    });

    const returnParams = new URLSearchParams({
      from: "tourist",
      date: selectedDate,
      event: selectedEvent.id,
      interest: selectedInterest,
      pace: selectedPace
    });

    routeStops.push({
      id: selectedEvent.id,
      step: String(routeStops.length + 1).padStart(2, "0"),
      label: "Event",
      title: selectedEvent.title,
      category: "event",
      categoryLabel: "Live event",
      description: `${selectedEvent.time || "Time not listed"} at ${selectedEvent.venue}.`,
      area: selectedEvent.venue,
      accessLabel: "Final stop",
      visitMinutes: 0,
      coordinates: selectedEvent.coordinates,
      detailUrl: `/events/${encodeURIComponent(selectedEvent.id)}?${returnParams.toString()}`
    });
  }

  let routeSpanKm = 0;

  for (let index = 1; index < routeStops.length; index += 1) {
    routeSpanKm +=
      calculateDistanceKm(
        routeStops[index - 1].coordinates,
        routeStops[index].coordinates
      ) || 0;
  }

  const estimatedWalkingMinutes = routeSpanKm > 0
    ? Math.max(1, Math.round((routeSpanKm / 4.5) * 60))
    : 0;
  const arrivalBufferMinutes =
    TOURIST_PACE_PROFILES[selectedPace]?.arrivalBufferMinutes || 15;
  const estimatedTotalMinutes =
    estimatedWalkingMinutes + attractionVisitMinutes + arrivalBufferMinutes;
  const eventStartMinutes = parseEventTimeToMinutes(selectedEvent?.time || "");
  const suggestedStartTime =
    eventStartMinutes !== Number.MAX_SAFE_INTEGER &&
    eventStartMinutes >= estimatedTotalMinutes
      ? formatMinutesAsClock(eventStartMinutes - estimatedTotalMinutes)
      : "";

  return {
    selectedDate,
    dateOptions,
    selectedEvent,
    alternativeEvents,
    routeStops,
    routeSpanKm: Number(routeSpanKm.toFixed(1)),
    estimatedWalkingMinutes,
    attractionVisitMinutes,
    arrivalBufferMinutes,
    estimatedTotalMinutes,
    suggestedStartTime,
    selectedInterest,
    selectedPace,
    routeThemeLabel: getTouristInterestLabel(selectedInterest),
    routePaceLabel: getTouristPaceLabel(selectedPace),
    touristPlacesCount: TOURIST_PLACES.length,
    usingCentralEvents: true,
    candidateCount: sortedCandidates.length
  };
}

function parseTouristRoutePoints(pointsText) {
  if (!pointsText || typeof pointsText !== "string") {
    return null;
  }

  const points = pointsText.split(";").map(pair => {
    const [lngText, latText] = pair.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);

    return { lng, lat };
  });

  if (points.length < 2 || points.length > 5) {
    return null;
  }

  const allValid = points.every(point => {
    return (
      Number.isFinite(point.lng) &&
      Number.isFinite(point.lat) &&
      point.lng >= -9.2 &&
      point.lng <= -7.5 &&
      point.lat >= 51.4 &&
      point.lat <= 52.4
    );
  });

  return allValid ? points : null;
}

async function getTouristWalkingRoute(points) {
  const coordinateText = points
    .map(point => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`)
    .join(";");

  const cached = touristWalkingRouteCache.get(coordinateText);

  if (
    cached &&
    Date.now() - cached.savedAt < TOURIST_WALKING_ROUTE_CACHE_TIME
  ) {
    return cached.route;
  }

  const response = await axios.get(
    `${OSRM_FOOT_ROUTE_URL}/${coordinateText}`,
    {
      timeout: 12000,
      headers: {
        "User-Agent": "VibeLee UCC student project"
      },
      params: {
        overview: "full",
        geometries: "geojson",
        steps: "true",
        alternatives: "false"
      }
    }
  );

  if (response.data?.code !== "Ok" || !response.data?.routes?.[0]) {
    throw new Error(response.data?.message || "No walking route was returned");
  }

  const osrmRoute = response.data.routes[0];

  if (
    !osrmRoute.geometry ||
    osrmRoute.geometry.type !== "LineString" ||
    !Array.isArray(osrmRoute.geometry.coordinates)
  ) {
    throw new Error("The walking route did not contain usable geometry");
  }

  const route = {
    geometry: osrmRoute.geometry,
    distanceMetres: Number(osrmRoute.distance || 0),
    durationSeconds: Number(osrmRoute.duration || 0),
    distanceKm: Number((Number(osrmRoute.distance || 0) / 1000).toFixed(2)),
    durationMinutes: Math.max(
      1,
      Math.round(Number(osrmRoute.duration || 0) / 60)
    )
  };

  touristWalkingRouteCache.set(coordinateText, {
    savedAt: Date.now(),
    route
  });

  return route;
}

app.get("/api/tourist-walking-route", async (req, res) => {
  const points = parseTouristRoutePoints(req.query.points);

  if (!points) {
    return res.status(400).json({
      message: "Provide between two and five valid Cork-area coordinates."
    });
  }

  try {
    const route = await getTouristWalkingRoute(points);

    res.json({
      source: "OpenStreetMap walking route",
      route
    });
  } catch (error) {
    console.error("Could not calculate tourist walking route:", error.message);

    res.status(502).json({
      message: "Walking directions are temporarily unavailable."
    });
  }
});

app.get("/", async (req, res) => {
  try {
    const searchQuery = cleanText(req.query.q || "");
    const selectedPrice = cleanText(req.query.price || "");
    const selectedCategories = parseSelectedEventCategories(
      req.query.categories || req.query.category || ""
    );
    const selectedScope = normaliseDiscoverScope(req.query.scope || "any");
    const isPersonalised = ["1", "true", "yes"].includes(
      cleanText(req.query.personalized || req.query.personalised || "")
        .toLowerCase()
    );
    const events = await getCorkGigsEvents();
    const preparedEvents = events.map(event => ({
      ...event,
      distanceFromCentreKm: event.coordinates
        ? calculateDistanceKm(CORK_CITY_CENTRE, event.coordinates)
        : null
    }));

    // Continue to accept the old single-date query while bookmarked links
    // are gradually replaced by the new inclusive date-range filter.
    const legacyDate =
      normaliseIsoDate(req.query.date || "") ||
      parseCorkGigsDateToIso(req.query.date || "");

    let selectedStartDate =
      normaliseIsoDate(req.query.from || "") || legacyDate;
    let selectedEndDate =
      normaliseIsoDate(req.query.to || "") || legacyDate;

    if (
      selectedStartDate &&
      selectedEndDate &&
      selectedStartDate > selectedEndDate
    ) {
      [selectedStartDate, selectedEndDate] = [
        selectedEndDate,
        selectedStartDate
      ];
    }

    const availableIsoDates = preparedEvents
      .map(event => event.isoDate || parseCorkGigsDateToIso(event.date))
      .filter(Boolean)
      .sort();

    const earliestEventDate = availableIsoDates[0] || "";
    const latestEventDate = availableIsoDates.at(-1) || "";

    // Search, date, price and the saved travel scope are applied first.
    // Category counts therefore describe the user's current discovery area.
    const eventsInCurrentScope = preparedEvents.filter(event => {
      const searchableText = `
        ${event.title}
        ${event.venue}
        ${event.date}
        ${event.price}
        ${event.venueAddress}
        ${event.categoryLabel || ""}
        ${(event.categories || []).join(" ")}
      `.toLowerCase();

      const eventIsoDate =
        event.isoDate || parseCorkGigsDateToIso(event.date);

      const matchesSearch = searchableText.includes(
        searchQuery.toLowerCase()
      );
      const matchesStartDate =
        !selectedStartDate ||
        (eventIsoDate && eventIsoDate >= selectedStartDate);
      const matchesEndDate =
        !selectedEndDate ||
        (eventIsoDate && eventIsoDate <= selectedEndDate);
      const matchesPrice =
        !selectedPrice || event.priceType === selectedPrice;
      const matchesScope = eventMatchesDiscoverScope(
        event,
        selectedScope
      );

      return (
        matchesSearch &&
        matchesStartDate &&
        matchesEndDate &&
        matchesPrice &&
        matchesScope
      );
    });

    const categoryCounts = Object.fromEntries(
      EVENT_FILTER_CATEGORIES.map(category => {
        if (category.id === "all") {
          return [category.id, eventsInCurrentScope.length];
        }

        if (category.id === "free") {
          return [
            category.id,
            eventsInCurrentScope.filter(event => event.priceType === "free")
              .length
          ];
        }

        return [
          category.id,
          eventsInCurrentScope.filter(event => {
            return event.categories?.includes(category.id);
          }).length
        ];
      })
    );

    let filteredEvents = eventsInCurrentScope.filter(event => {
      return eventMatchesSelectedCategories(event, selectedCategories);
    });

    if (isPersonalised) {
      filteredEvents = sortPersonalisedDiscoverEvents(
        filteredEvents,
        selectedCategories,
        selectedPrice,
        selectedScope
      );
    }

    const categoryFilters = EVENT_FILTER_CATEGORIES.map(category => {
      const count = categoryCounts[category.id] || 0;
      const selected =
        category.id === "all"
          ? selectedCategories.length === 0
          : selectedCategories.includes(category.id);

      return {
        ...category,
        count,
        selected,
        disabled: category.id !== "all" && count === 0 && !selected
      };
    });

    const selectedInterestLabels = selectedCategories
      .filter(category => EVENT_CONTENT_CATEGORY_IDS.has(category))
      .map(category => EVENT_CATEGORY_BY_ID[category]?.shortLabel)
      .filter(Boolean);

    const selectedBudgetLabel =
      selectedPrice === "free"
        ? "Free events"
        : selectedPrice === "paid"
          ? "Ticketed events"
          : "Any price";

    res.render("index", {
      events: filteredEvents,
      searchQuery,
      selectedStartDate,
      selectedEndDate,
      selectedPrice,
      selectedCategories,
      selectedScope,
      selectedScopeLabel: getDiscoverScopeLabel(selectedScope),
      selectedInterestLabels,
      selectedBudgetLabel,
      isPersonalised,
      categoryFilters,
      categoryScopeCount: eventsInCurrentScope.length,
      earliestEventDate,
      latestEventDate,
      dateRangeSummary: buildDateRangeSummary(
        selectedStartDate,
        selectedEndDate
      )
    });
  } catch (error) {
    res.status(500).send(`
      <h1>Could not load CorkGigs events</h1>
      <p>${error.message}</p>
    `);
  }
});


app.get("/tourist", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const plan = buildTouristPlan(events, req.query);

    res.render("tourist", {
      pageTitle: "Tourist mode | VibeLee",
      ...plan
    });
  } catch (error) {
    console.error("Could not build tourist mode:", error);

    res.status(500).send(`
      <h1>Could not build the tourist route</h1>
      <p>${error.message}</p>
    `);
  }
});

app.get("/surprise", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const plan = await buildSurprisePlan(events, req.query);

    res.render("surprise", {
      pageTitle: "Surprise me | VibeLee",
      ...plan
    });
  } catch (error) {
    console.error("Could not build Surprise Me mode:", error);

    res.status(500).send(`
      <h1>Could not choose an event</h1>
      <p>${error.message}</p>
    `);
  }
});

app.get("/api/events/:id/preview", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const event = events.find(item => item.id === req.params.id);

    if (!event) {
      return res.status(404).json({
        message: "Event not found"
      });
    }

    const preview = await getEventPreview(event);

    res.set("Cache-Control", "public, max-age=1800");
    res.json(preview);
  } catch (error) {
    console.error("Could not load event preview:", error.message);

    res.status(500).json({
      message: "Could not load the event image"
    });
  }
});

app.get("/events/:id", async (req, res) => {
  const returnMode = req.query.from || "discover";
  const returnParams = new URLSearchParams();

  if (req.query.date) returnParams.set("date", req.query.date);
  if (req.query.event) returnParams.set("event", req.query.event);

  if (returnMode === "tourist") {
    if (req.query.interest) returnParams.set("interest", req.query.interest);
    if (req.query.pace) returnParams.set("pace", req.query.pace);
  }

  if (returnMode === "surprise") {
    if (req.query.type) returnParams.set("type", req.query.type);
    if (req.query.price) returnParams.set("price", req.query.price);
    if (req.query.distance) returnParams.set("distance", req.query.distance);
  }

  let backUrl = "/";
  let backLabel = "Discover";

  if (returnMode === "tourist") {
    backUrl = `/tourist${returnParams.toString() ? `?${returnParams.toString()}` : ""}`;
    backLabel = "Tourist route";
  } else if (returnMode === "surprise") {
    backUrl = `/surprise${returnParams.toString() ? `?${returnParams.toString()}` : ""}`;
    backLabel = "Surprise me";
  }

  try {
    const events = await getCorkGigsEvents();
    const event = events.find(item => item.id === req.params.id);

    if (!event) {
      return res.status(404).render("event-details", {
        event: null,
        pageTitle: "Event not found",
        backUrl,
        backLabel
      });
    }

    const detailedEvent = await getDetailedEvent(event, events);

    res.render("event-details", {
      event: detailedEvent,
      pageTitle: `${detailedEvent.title} | VibeLee`,
      backUrl,
      backLabel
    });
  } catch (error) {
    console.error("Could not load event details:", error);

    res.status(500).render("event-details", {
      event: null,
      pageTitle: "Could not load event",
      backUrl,
      backLabel
    });
  }
});

app.get("/refresh-events", async (req, res) => {
  try {
    cachedEvents = [];
    lastFetched = 0;
    eventsFetchPromise = null;
    eventDetailCache.clear();
    eventbriteMatchCache.clear();
    pageMetadataCache.clear();
    eventPreviewCache.clear();
    bookingPriceCache.clear();

    await getCorkGigsEvents();

    res.redirect("/");
  } catch (error) {
    res.status(500).send(`
      <h1>Could not refresh events</h1>
      <p>${error.message}</p>
    `);
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();

    res.json({
      count: events.length,
      events
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not scrape CorkGigs",
      error: error.message
    });
  }
});

app.get("/api/venues", (req, res) => {
  res.json({
    cacheCount: Object.keys(venueCache).length,
    overrideCount: Object.keys(venueOverrides).length,
    venues: venueCache
  });
});

app.get("/debug", async (req, res) => {
  try {
    const response = await axios.get(CORKGIGS_URL, {
      httpsAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 Student Project Event Scraper"
      }
    });

    const $ = cheerio.load(response.data);

    const rows = [];

    $("tr").each((index, row) => {
      const cells = $(row)
        .find("td")
        .map((i, cell) => cleanText($(cell).text()))
        .get()
        .filter(Boolean);

      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    res.json(rows.slice(0, 40));
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.get("/api/corkgigs-row-debug", async (req, res) => {
  try {
    const titleQuery = cleanText(req.query.title || "").toLowerCase();

    if (!titleQuery) {
      return res.status(400).json({
        message: "Add a title query, for example ?title=Cry Before Dawn"
      });
    }

    const response = await axios.get(CORKGIGS_URL, {
      httpsAgent,
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 VibeLee Student Project"
      }
    });

    const $ = cheerio.load(response.data);
    const matchingRows = [];

    $("tr.event").each((index, row) => {
      const rowText = cleanText($(row).text());

      if (!rowText.toLowerCase().includes(titleQuery)) {
        return;
      }

      const cells = $(row)
        .find("td")
        .map((cellIndex, cell) => ({
          index: cellIndex,
          text: cleanText($(cell).text()),
          html: $(cell).html() || ""
        }))
        .get();

      const links = $(row)
        .find("a")
        .map((linkIndex, link) => ({
          index: linkIndex,
          text: cleanText($(link).text()),
          href: $(link).attr("href") || "",
          absoluteHref: makeAbsoluteUrl($(link).attr("href")),
          title: $(link).attr("title") || "",
          className: $(link).attr("class") || "",
          onclick: $(link).attr("onclick") || ""
        }))
        .get();

      matchingRows.push({
        rowIndex: index,
        rowText,
        rowHtml: $.html(row),
        cells,
        links
      });
    });

    res.json({
      source: CORKGIGS_URL,
      query: titleQuery,
      matches: matchingRows.length,
      rows: matchingRows
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.get("/api/ticket-audit", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
    const searchText = cleanText(req.query.q || "").toLowerCase();

    const selectedEvents = events
      .filter(event => {
        if (!searchText) return true;

        return `${event.title} ${event.venue}`
          .toLowerCase()
          .includes(searchText);
      })
      .slice(0, limit);

    const results = await mapWithConcurrency(
      selectedEvents,
      3,
      async event => {
        const pageUrl = event.eventInfoUrl || event.url;
        const metadata = await scrapePageMetadata(pageUrl);
        const selectedTicketUrl = chooseBestTicketUrl(
          metadata.ticketUrl,
          event.ticketUrl
        );

        return {
          title: event.title,
          venue: event.venue,
          date: event.date,
          eventInfoUrl: pageUrl,
          corkGigsTicketUrl: event.ticketUrl || "",
          detectedTicketUrl: metadata.ticketUrl || "",
          selectedTicketUrl,
          confidence: metadata.ticketConfidence || "none",
          reason: metadata.ticketReason || "",
          source: metadata.ticketSource || "",
          hasEmbeddedTickets: Boolean(metadata.hasEmbeddedTickets),
          topCandidates: (metadata.ticketCandidates || []).map(candidate => ({
            url: candidate.url,
            score: candidate.score,
            source: candidate.source,
            description: candidate.description,
            reason: candidate.reason
          }))
        };
      }
    );

    res.json({
      scanned: selectedEvents.length,
      query: searchText,
      note:
        "Only event-specific pages and direct provider links are accepted. Venue calendars, maps, social pages, restaurant bookings, transport bookings and generic ticket shops are excluded.",
      results
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.get("/api/category-audit", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const searchText = cleanText(req.query.q || "").toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);

    const matchingEvents = events
      .filter(event => {
        if (!searchText) return true;

        return `${event.title} ${event.venue}`
          .toLowerCase()
          .includes(searchText);
      })
      .slice(0, limit);

    const summary = Object.fromEntries(
      EVENT_FILTER_CATEGORIES
        .filter(category => !["all", "free"].includes(category.id))
        .map(category => [
          category.id,
          matchingEvents.filter(event => {
            return event.categories?.includes(category.id);
          }).length
        ])
    );

    summary.free = matchingEvents.filter(event => {
      return event.priceType === "free";
    }).length;

    res.json({
      scanned: matchingEvents.length,
      overrideCount: EVENT_CATEGORY_OVERRIDES.length,
      summary,
      events: matchingEvents.map(event => ({
        title: event.title,
        venue: event.venue,
        date: event.date,
        priceType: event.priceType,
        categories: event.categories,
        primaryCategory: event.primaryCategory,
        categoryLabel: event.categoryLabel
      }))
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.get("/api/eventbrite/status", async (req, res) => {
  if (!EVENTBRITE_TOKEN) {
    return res.status(503).json({
      connected: false,
      message: "EVENTBRITE_TOKEN is missing from .env"
    });
  }

  try {
    const response = await axios.get(`${EVENTBRITE_BASE_URL}/users/me/`, {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
        Accept: "application/json"
      }
    });

    res.json({
      connected: true,
      user: {
        id: response.data.id,
        name: response.data.name
      }
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      connected: false,
      message:
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message
    });
  }
});

app.get("/api/eventbrite-debug", async (req, res) => {
  if (!EVENTBRITE_TOKEN) {
    return res.status(503).json({
      message: "EVENTBRITE_TOKEN is missing from .env"
    });
  }

  try {
    const events = await getCorkGigsEvents();
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 25;
    const selectedEvents = events.slice(0, limit);

    const results = await mapWithConcurrency(
      selectedEvents,
      3,
      async event => {
        const eventbriteUrl = event.eventbriteUrl || "";
        const eventbriteId =
          event.eventbriteId || extractEventbriteEventId(eventbriteUrl);
        const eventbriteEvent = eventbriteId
          ? await fetchEventbriteEvent(eventbriteId)
          : null;
        const apiError = eventbriteId
          ? eventbriteFetchErrors.get(eventbriteId) || null
          : null;

        return {
          title: event.title,
          date: event.date,
          time: event.time,
          venue: event.venue,
          corkGigsUrl: CORKGIGS_URL,
          eventInfoUrl: event.eventInfoUrl || "",
          ticketUrl: event.ticketUrl || "",
          rowEventbriteUrl: eventbriteUrl,
          resolvedEventbriteUrl: eventbriteUrl,
          eventbriteId,
          linkFound: Boolean(eventbriteUrl),
          idFound: Boolean(eventbriteId),
          apiVerified: Boolean(eventbriteEvent),
          apiError,
          listingPrice: event.price || "",
          priceType: eventbriteEvent?.priceType || event.priceType,
          priceLabel:
            eventbriteEvent?.priceLabel ||
            event.price ||
            (event.priceType === "free"
              ? "Free"
              : event.priceType === "paid"
                ? "Ticketed event"
                : "Price not confirmed"),
          eventbriteTitle: eventbriteEvent?.title || ""
        };
      }
    );

    res.json({
      scanned: results.length,
      linksFound: results.filter(result => result.linkFound).length,
      idsFound: results.filter(result => result.idFound).length,
      apiVerified: results.filter(result => result.apiVerified).length,
      note:
        "A found link and a successful API verification are separate checks. API errors are shown per event.",
      results
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.get("/api/price-debug", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();

    const summary = {
      free: events.filter(event => event.priceType === "free").length,
      paid: events.filter(event => event.priceType === "paid").length,
      unknown: events.filter(event => event.priceType === "unknown").length
    };

    const sample = events.slice(0, 30).map(event => {
      return {
        title: event.title,
        venue: event.venue,
        date: event.date,
        time: event.time,
        price: event.price,
        priceType: event.priceType,
        ticketUrl: event.ticketUrl,
        eventbriteId: event.eventbriteId,
        url: event.url
      };
    });

    res.json({
      total: events.length,
      summary,
      sample
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});


app.get("/api/price-audit", async (req, res) => {
  try {
    const events = await getCorkGigsEvents();
    const searchText = cleanText(req.query.q || "").toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 30);

    const selectedEvents = events
      .filter(event => {
        if (!searchText) return true;

        return `${event.title} ${event.venue}`
          .toLowerCase()
          .includes(searchText);
      })
      .slice(0, limit);

    const results = await mapWithConcurrency(
      selectedEvents,
      2,
      async event => {
        const detailedEvent = await getDetailedEvent(event, events);

        return {
          title: event.title,
          venue: event.venue,
          date: event.date,
          listingPrice: event.price || "Not listed",
          displayedPrice: detailedEvent.priceLabel,
          priceType: detailedEvent.priceType,
          priceSource: detailedEvent.priceSource,
          priceConfidence: detailedEvent.priceConfidence,
          priceNote: detailedEvent.priceNote,
          bookingUrl: detailedEvent.ticketUrl || "",
          eventInfoUrl: event.eventInfoUrl || event.url || ""
        };
      }
    );

    res.json({
      scanned: results.length,
      query: searchText,
      priority:
        "Event-specific booking page, event page, Eventbrite API, then CorkGigs listing.",
      results
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CorkGigs MapLibre app running at http://localhost:${PORT}`);
});
