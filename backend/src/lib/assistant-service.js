import OpenAI from "openai";
import { env } from "../config/env.js";
import { query } from "../config/database.js";
import {
  brandDealerMap,
  catalogModels,
  getBrandPresentation,
  getDealerPresentation,
  getModelPresentation,
  getPartGroupKeyByName,
  normalizeBrandKey,
  partTemplates,
  supportedDealerBrands
} from "./catalog-data.js";
import {
  ASSISTANT_LOCALES,
  buildAssistantInstructions,
  getAssistantStarterPrompts,
  normalizeAssistantLocale,
  normalizeAssistantMode
} from "./assistant-prompts.js";

const openaiClient = env.openai.apiKey
  ? new OpenAI({
    apiKey: env.openai.apiKey,
    timeout: 20_000,
    maxRetries: 1
  })
  : null;

const PART_ALIASES = {
  oilfilter: ["oil filter", "oil filters", "filter", "engine oil filter", "فلتر زيت", "فلتر الزيت", "فلتر الماتور"],
  brakepads: ["brake pad", "brake pads", "pads", "front brake pads", "rear brake pads", "تيل", "تيل فرامل", "فرامل"],
  carbattery: ["battery", "car battery", "بطارية", "بطاريه", "بطارية العربية", "بطاريه العربيه"],
  wiperblades: ["wiper", "wiper blade", "wiper blades", "مساحات", "مساحة", "مساحات المطر"],
  sparkplugs: ["spark plug", "spark plugs", "plug", "plugs", "بوجيه", "بوجيهات"],
  alternator: ["alternator", "alternator assembly", "دينامو", "الدينامو"],
  shockabsorber: ["shock absorber", "shock absorbers", "shock", "amortizer", "مساعد", "مساعدين"],
  gaskets: ["gasket", "gaskets", "جوان", "جوانات"],
  waterpump: ["water pump", "coolant pump", "طلمبة مياه", "طرمبة مياه"],
  tierodends: ["tie rod", "tie rod ends", "طرف دركسيون", "بارة دركسيون"],
  oxygensensor: ["oxygen sensor", "o2 sensor", "lambda sensor", "حساس اكسجين", "حساس شكمان"],
  serpentinebelt: ["serpentine belt", "drive belt", "fan belt", "سير", "سير مجموعه", "سير مجموعة"],
  coldairintake: ["cold air intake", "intake", "فلتر رياضي", "سحب هوا رياضي"],
  coilover: ["coilover", "coilover kit", "طقم كويل اوفر", "طقم coilover"],
  bigbrakekit: ["big brake kit", "brake kit", "طقم فرامل كبير", "big brakes"],
  highperformancetires: ["performance tires", "high performance tires", "tires", "كاوتش", "فرد كاوتش"]
};

const DIAGNOSIS_PROFILES = [
  {
    key: "starting_issue",
    patterns: ["won't start", "will not start", "not start", "clicking", "starter", "battery dead", "مش بتدور", "مبتدورش", "تك تك", "المارش"],
    severity: "moderate",
    likelyIssues: {
      en: ["Weak battery", "Starter motor issue", "Loose battery terminals"],
      "ar-eg": ["البطارية ضعيفة", "مشكلة في المارش", "أطراف البطارية محتاجة تتراجع"]
    },
    suggestedAction: "book_inspection",
    relatedPartGroups: ["carbattery", "alternator"]
  },
  {
    key: "overheating",
    patterns: ["overheat", "overheating", "hot", "coolant", "temperature", "سخونة", "بتسخن", "حرارة", "مياه الردياتير"],
    severity: "urgent",
    likelyIssues: {
      en: ["Cooling system leak", "Water pump issue", "Low coolant or radiator problem"],
      "ar-eg": ["في مشكلة في دورة التبريد", "ممكن طلمبة المياه فيها مشكلة", "ممكن المياه أو الردياتير محتاجين فحص"]
    },
    suggestedAction: "tow_truck",
    relatedPartGroups: ["waterpump", "gaskets"]
  },
  {
    key: "brake_issue",
    patterns: ["brake", "brakes", "stopping", "squeak", "grinding", "فرامل", "تيل", "صوت فرامل"],
    severity: "urgent",
    likelyIssues: {
      en: ["Worn brake pads", "Brake hardware issue", "Brake fluid or disc inspection needed"],
      "ar-eg": ["التيل ممكن يكون مخلص", "في مشكلة في مجموعة الفرامل", "لازم يتراجع زيت الفرامل والطقم كله"]
    },
    suggestedAction: "tow_truck",
    relatedPartGroups: ["brakepads", "bigbrakekit"]
  },
  {
    key: "smoke_or_burn",
    patterns: ["smoke", "burning smell", "burnt", "دخان", "ريحة شياط", "ريحة حرق"],
    severity: "urgent",
    likelyIssues: {
      en: ["Fluid leak onto hot components", "Electrical short risk", "Engine overheating side effect"],
      "ar-eg": ["ممكن فيه تسريب على أجزاء سخنة", "ممكن يكون في قفلة كهرباء", "وممكن ده تابع لسخونة موتور"]
    },
    suggestedAction: "tow_truck",
    relatedPartGroups: ["waterpump", "alternator"]
  },
  {
    key: "vibration_or_suspension",
    patterns: ["vibration", "shaking", "noise", "suspension", "steering", "رعشة", "رجرجة", "خبطة", "صوت من قدام", "دركسيون"],
    severity: "moderate",
    likelyIssues: {
      en: ["Suspension wear", "Tie-rod or steering play", "Shock absorber issue"],
      "ar-eg": ["في استهلاك في العفشة", "ممكن أطراف الدركسيون فيها لعب", "وممكن المساعدين محتاجين فحص"]
    },
    suggestedAction: "book_inspection",
    relatedPartGroups: ["shockabsorber", "tierodends"]
  },
  {
    key: "check_engine_or_misfire",
    patterns: ["check engine", "misfire", "engine light", "rough idle", "لمبة تشيك", "نتشة", "تقطيع", "رعشة موتور"],
    severity: "moderate",
    likelyIssues: {
      en: ["Ignition issue", "Oxygen sensor or emissions sensor issue", "Fuel or air mix problem"],
      "ar-eg": ["ممكن يكون في مشكلة إشعال", "أو حساس أكسجين / حساس مرتبط بالعادم", "أو مشكلة خليط هوا وبنزين"]
    },
    suggestedAction: "book_inspection",
    relatedPartGroups: ["sparkplugs", "oxygensensor"]
  }
];

const BRAND_ALIASES = {
  bmw: ["bmw", "بي ام دبليو", "بى ام دبليو", "بي ام", "بى ام"],
  audi: ["audi", "اودي", "أودي"],
  toyota: ["toyota", "تويوتا", "تويوطه"],
  hyundai: ["hyundai", "هيونداي", "هيونداى"],
  mg: ["mg", "ام جي", "إم جي", "ام جى", "إم جى"],
  nissan: ["nissan", "نيسان"],
  mercedes: ["mercedes", "mercedes benz", "مرسيدس", "مرسيدس بنز", "بنز"],
  peugeot: ["peugeot", "بيجو", "بيچو"],
  kia: ["kia", "كيا"],
  chevrolet: ["chevrolet", "شيفروليه", "شيفرولية", "شيفرولت", "شيفرليه"]
};

const MODEL_ALIASES = {
  "toyota-corolla": ["corolla", "كورولا"],
  "toyota-camry": ["camry", "كامري"],
  "toyota-yaris": ["yaris", "يارس"],
  "toyota-fortuner": ["fortuner", "فورتشنر"],
  "toyota-hilux": ["hilux", "هايلكس"],
  "mg-5": ["mg 5", "mg5", "ام جي 5"],
  "mg-zs": ["mg zs", "mg-zs", "زد اس", "zs", "ام جي زد اس", "ام جي zs"],
  "mg-g50-plus": ["g50", "g50 plus", "ام جي g50", "ام جي جي 50"],
  "mg-1": ["mg 1", "ام جي 1"],
  "mg-cyberster": ["cyberster", "سايبرستر"],
  "nissan-sunny-n16": ["sunny n16", "صني n16", "صني"],
  "nissan-sunny-n17": ["sunny n17", "صني n17"],
  "nissan-qashqai": ["qashqai", "قشقاي", "كاشكاي", "قاشقاي"],
  "nissan-sentra": ["sentra", "سنترا"],
  "nissan-x-trail": ["x trail", "x-trail", "اكس تريل", "إكس تريل"],
  "hyundai-elantra": ["elantra", "النترا", "إلنترا"],
  "hyundai-tucson": ["tucson", "توسان"],
  "hyundai-accent": ["accent", "اكسنت", "أكسنت"],
  "kia-rio": ["rio", "ريو"],
  "kia-cerato": ["cerato", "سيراتو"],
  "kia-carens": ["carens", "كارينز"],
  "kia-seltos": ["seltos", "سيلتوس"],
  "kia-carnival": ["carnival", "كارنفال"],
  "mercedes-cla-180": ["cla 180", "cla180", "cla"],
  "mercedes-cla200": ["cla 200", "cla200"],
  "mercedes-e280": ["e280", "e 280"],
  "mercedes-e200": ["e200", "e 200"],
  "mercedes-e180": ["e180", "e 180"],
  "bmw-116i-e81": ["116i e81", "116i", "116 اي"],
  "bmw-116i-e87": ["116i e87"],
  "bmw-118i-f20": ["118i", "118i f20"],
  "bmw-335i-f30": ["335i", "335i f30"],
  "bmw-316i-f30": ["316i", "316i f30"],
  "audi-a3": ["a3", "audi a3"],
  "audi-a4": ["a4", "audi a4"],
  "audi-a6": ["a6", "audi a6"],
  "audi-q3": ["q3", "audi q3"],
  "audi-q5": ["q5", "audi q5"],
  "peugeot-508": ["508", "بيجو 508"],
  "peugeot-3008": ["3008", "بيجو 3008"],
  "peugeot-2008": ["2008", "بيجو 2008"],
  "peugeot-308": ["308", "بيجو 308"],
  "peugeot-408": ["408", "بيجو 408"],
  "chevrolet-optra": ["optra", "اوبترا", "أوبترا"],
  "chevrolet-captiva": ["captiva", "كابتيفا"],
  "chevrolet-tahoe": ["tahoe", "تاهو"],
  "chevrolet-colorado": ["colorado", "كولورادو"],
  "chevrolet-silverado": ["silverado", "سيلفرادو"]
};

const PART_GROUP_LABELS = {
  en: {
    oilfilter: "oil filter",
    brakepads: "brake pads",
    carbattery: "car battery",
    wiperblades: "wiper blades",
    sparkplugs: "spark plugs",
    alternator: "alternator",
    shockabsorber: "shock absorber",
    gaskets: "gaskets",
    waterpump: "water pump",
    tierodends: "tie rod ends",
    oxygensensor: "oxygen sensor",
    serpentinebelt: "serpentine belt",
    coldairintake: "cold air intake",
    coilover: "coilover kit",
    bigbrakekit: "big brake kit",
    highperformancetires: "high-performance tires"
  },
  "ar-eg": {
    oilfilter: "فلتر زيت",
    brakepads: "تيل فرامل",
    carbattery: "بطارية",
    wiperblades: "مساحات",
    sparkplugs: "بوجيهات",
    alternator: "دينامو",
    shockabsorber: "مساعد",
    gaskets: "جوانات",
    waterpump: "طلمبة مياه",
    tierodends: "طرف دركسيون",
    oxygensensor: "حساس أكسجين",
    serpentinebelt: "سير مجموعة",
    coldairintake: "سحب هوا رياضي",
    coilover: "طقم كويل أوفر",
    bigbrakekit: "طقم فرامل كبير",
    highperformancetires: "كاوتش رياضي"
  }
};

function normalizeLooseText(value) {
  return normalizeArabicDigits(String(value || ""))
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArabicDigits(value) {
  const arabicZero = "٠".charCodeAt(0);
  const persianZero = "۰".charCodeAt(0);

  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - arabicZero))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - persianZero));
}

function hasLooseMatch(haystack, candidate) {
  const normalizedHaystack = normalizeLooseText(haystack);
  const normalizedCandidate = normalizeLooseText(candidate);

  if (!normalizedCandidate) {
    return false;
  }

  return new RegExp(`(^|\\s)${escapeRegExp(normalizedCandidate)}(\\s|$)`).test(normalizedHaystack);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeBy(items, resolver) {
  const seen = new Set();
  return items.filter((item) => {
    const key = resolver(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildStarterPayload() {
  return {
    locales: Object.values(ASSISTANT_LOCALES),
    starters: {
      en: getAssistantStarterPrompts("en"),
      "ar-eg": getAssistantStarterPrompts("ar-eg")
    }
  };
}

function summarizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.role && entry?.text)
    .slice(-6)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${String(entry.text).trim()}`)
    .join("\n");
}

function normalizeAssistantReplyText(reply, locale) {
  const normalizedLocale = normalizeAssistantLocale(locale);

  let cleaned = String(reply || "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (normalizedLocale === "ar-eg") {
    cleaned = cleaned
      .replace(/\n\n+/g, "\n")
      .replace(/\s*•\s*/g, "\n• ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  return cleaned;
}

function detectPartGroups(message) {
  const normalizedMessage = normalizeLooseText(message);
  const matchedGroups = Object.entries(PART_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => new RegExp(`(^|\\s)${escapeRegExp(normalizeLooseText(alias))}(\\s|$)`).test(normalizedMessage)))
    .map(([groupKey]) => groupKey);

  return matchedGroups.length ? matchedGroups : [];
}

function extractVehicleFromMessage(message) {
  const normalizedMessage = normalizeLooseText(message);
  const yearMatch = normalizedMessage.match(/\b20\d{2}\b/);
  const detectedYear = yearMatch ? Number(yearMatch[0]) : null;

  let brandKey = null;
  for (const [candidateBrandKey, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.some((alias) => hasLooseMatch(normalizedMessage, alias))) {
      brandKey = candidateBrandKey;
      break;
    }
  }

  if (!brandKey) {
    const knownBrandKeys = dedupeBy(catalogModels.map((model) => model.brandKey), (item) => item);
    for (const candidate of knownBrandKeys) {
      if (normalizedMessage.includes(normalizeLooseText(candidate))) {
        brandKey = candidate;
        break;
      }
    }
  }

  let modelMatch = null;
  for (const model of catalogModels) {
    const patterns = [
      normalizeLooseText(model.name),
      normalizeLooseText(model.modelKey.replace(/-/g, " ")),
      ...(MODEL_ALIASES[model.modelKey] || []).map((alias) => normalizeLooseText(alias))
    ].filter(Boolean);

    if (patterns.some((pattern) => pattern && hasLooseMatch(normalizedMessage, pattern))) {
      if (!modelMatch || patternLength(model) > patternLength(modelMatch)) {
        modelMatch = model;
      }
    }
  }

  if (modelMatch && !brandKey) {
    brandKey = modelMatch.brandKey;
  }

  return {
    brandKey: brandKey ? normalizeBrandKey(brandKey) : null,
    modelKey: modelMatch?.modelKey || null,
    modelName: modelMatch?.name || null,
    year: detectedYear
  };
}

function patternLength(model) {
  return Math.max(
    String(model?.name || "").length,
    String(model?.modelKey || "").length
  );
}

function getMissingVehicleFields(vehicle) {
  const missing = [];

  if (!vehicle.brandKey) {
    missing.push("brand");
  }
  if (!vehicle.modelKey) {
    missing.push("model");
  }
  if (!vehicle.year) {
    missing.push("year");
  }

  return missing;
}

function getVehicleLabelForReply(vehicle, locale) {
  const pieces = [];

  if (vehicle.brandKey) {
    pieces.push(String(vehicle.brandKey).toUpperCase());
  }
  if (vehicle.modelName) {
    pieces.push(vehicle.modelName);
  }
  if (vehicle.year) {
    pieces.push(String(vehicle.year));
  }

  return pieces.length ? pieces.join(" ") : (locale === "ar-eg" ? "العربية دي" : "this vehicle");
}

function getPartGroupLabel(groupKey, locale) {
  return PART_GROUP_LABELS[locale]?.[groupKey] || PART_GROUP_LABELS.en[groupKey] || "";
}

function resolveDealerScopeFromVehicle(context = {}, vehicle = {}) {
  const explicitBrandKey = normalizeBrandKey(vehicle.brandKey || "");
  const contextDealerSlug = String(context.dealerSlug || "").trim();
  const contextDealerBrands = supportedDealerBrands[contextDealerSlug] || [];

  if (explicitBrandKey && contextDealerSlug && !contextDealerBrands.includes(explicitBrandKey)) {
    return {
      dealerId: null,
      dealerSlug: brandDealerMap[explicitBrandKey] || "",
      brandKey: explicitBrandKey
    };
  }

  return {
    dealerId: Number(context.dealerId || 0) || null,
    dealerSlug: contextDealerSlug,
    brandKey: explicitBrandKey || normalizeBrandKey(context.brandKey || "")
  };
}

async function resolveDealerByContext({ dealerId = null, dealerSlug = "", brandKey = "" } = {}) {
  const normalizedDealerId = Number(dealerId || 0);
  const normalizedDealerSlug = String(dealerSlug || "").trim();
  const fallbackDealerSlug = !normalizedDealerSlug && brandKey ? brandDealerMap[normalizeBrandKey(brandKey)] : "";

  const rows = await query(
    `
      SELECT
        id,
        name,
        slug,
        description,
        location
      FROM dealers
      WHERE (:dealerId > 0 AND id = :dealerId)
         OR (:dealerSlug <> '' AND slug = :dealerSlug)
      LIMIT 1
    `,
    {
      dealerId: normalizedDealerId,
      dealerSlug: normalizedDealerSlug || fallbackDealerSlug || ""
    }
  );

  if (!rows[0]) {
    return null;
  }

  return {
    id: Number(rows[0].id),
    name: rows[0].name,
    slug: rows[0].slug,
    description: rows[0].description,
    location: rows[0].location,
    image: getDealerPresentation(rows[0].slug).image
  };
}

async function resolveSelectedPart({ partId = null, partSlug = "" } = {}) {
  const normalizedPartId = Number(partId || 0);
  const normalizedPartSlug = String(partSlug || "").trim();

  if (!normalizedPartId && !normalizedPartSlug) {
    return null;
  }

  const rows = await query(
    `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.part_type AS partType,
        p.price,
        p.rating,
        p.part_number AS partNumber,
        p.image_url AS imageUrl,
        p.serial_number AS serialNumber,
        b.id AS brandId,
        b.brand_key AS brandKey,
        b.name AS brandName,
        d.id AS dealerId,
        d.name AS dealerName,
        d.slug AS dealerSlug
      FROM parts p
      INNER JOIN brands b
        ON b.id = p.brand_id
      INNER JOIN dealers d
        ON d.id = p.dealer_id
      WHERE p.active = 1
        AND (
          (:partId > 0 AND p.id = :partId)
          OR (:partSlug <> '' AND p.slug = :partSlug)
        )
      LIMIT 1
    `,
    {
      partId: normalizedPartId,
      partSlug: normalizedPartSlug
    }
  );

  return rows[0]
    ? {
      id: Number(rows[0].id),
      slug: rows[0].slug,
      name: rows[0].name,
      type: rows[0].partType === "original" ? "Original" : "Aftermarket",
      price: Number(rows[0].price || 0),
      rating: Number(rows[0].rating || 0),
      partNumber: rows[0].partNumber,
      serialNumber: rows[0].serialNumber,
      image: rows[0].imageUrl || "./pictures/autofix logo.png",
      groupKey: getPartGroupKeyByName(rows[0].name),
      brand: {
        id: Number(rows[0].brandId),
        key: rows[0].brandKey,
        name: rows[0].brandName,
        logo: getBrandPresentation(rows[0].brandKey).logo
      },
      dealer: {
        id: Number(rows[0].dealerId),
        name: rows[0].dealerName,
        slug: rows[0].dealerSlug,
        image: getDealerPresentation(rows[0].dealerSlug).image
      }
    }
    : null;
}

function buildResolvedVehicle(context = {}, extracted = {}) {
  const brandKey = normalizeBrandKey(extracted.brandKey || context.brandKey || "");
  const modelKey = String(extracted.modelKey || context.modelKey || "").trim().toLowerCase();
  const year = Number(extracted.year || context.year || 0) || null;
  const modelPresentation = getModelPresentation(modelKey);

  return {
    brandKey: brandKey || "",
    modelKey,
    modelName: extracted.modelName || context.modelName || modelPresentation?.name || "",
    year,
    vehicleLabel: brandKey && (extracted.modelName || context.modelName || modelPresentation?.name) && year
      ? `${brandKey.toUpperCase()} ${extracted.modelName || context.modelName || modelPresentation?.name} ${year}`
      : ""
  };
}

function mapAssistantPart(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    groupKey: getPartGroupKeyByName(row.name),
    type: row.partType === "original" ? "Original" : "Aftermarket",
    price: Number(row.price || 0),
    rating: Number(row.rating || 0),
    stockQuantity: Number(row.stockQuantity || 0),
    partNumber: row.partNumber,
    serialNumber: row.serialNumber,
    image: row.imageUrl || "./pictures/autofix logo.png",
    brand: {
      id: Number(row.brandId),
      key: row.brandKey,
      name: row.brandName,
      logo: getBrandPresentation(row.brandKey).logo
    },
    dealer: {
      id: Number(row.dealerId),
      name: row.dealerName,
      slug: row.dealerSlug,
      image: getDealerPresentation(row.dealerSlug).image
    },
    vehicle: row.modelId
      ? {
        id: Number(row.modelId),
        key: row.modelKey,
        name: row.modelName,
        year: Number(row.yearValue || 0) || null
      }
      : null
  };
}

async function fetchCompatiblePartsForVehicle(vehicle, dealer = null) {
  if (!vehicle.brandKey || !vehicle.modelKey || !vehicle.year) {
    return [];
  }

  const rows = await query(
    `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.part_type AS partType,
        p.price,
        p.rating,
        p.stock_quantity AS stockQuantity,
        p.part_number AS partNumber,
        p.serial_number AS serialNumber,
        p.image_url AS imageUrl,
        b.id AS brandId,
        b.brand_key AS brandKey,
        b.name AS brandName,
        d.id AS dealerId,
        d.name AS dealerName,
        d.slug AS dealerSlug,
        m.id AS modelId,
        m.model_key AS modelKey,
        m.name AS modelName,
        vy.year_value AS yearValue
      FROM part_compatibility pc
      INNER JOIN parts p
        ON p.id = pc.part_id
       AND p.active = 1
      INNER JOIN brands b
        ON b.id = pc.brand_id
      INNER JOIN models m
        ON m.id = pc.model_id
      INNER JOIN vehicle_years vy
        ON vy.id = pc.vehicle_year_id
      INNER JOIN dealers d
        ON d.id = p.dealer_id
      WHERE b.brand_key = :brandKey
        AND m.model_key = :modelKey
        AND vy.year_value = :yearValue
        AND (:dealerId = 0 OR d.id = :dealerId)
      ORDER BY
        CASE p.part_type WHEN 'original' THEN 0 ELSE 1 END,
        p.rating DESC,
        p.name ASC
    `,
    {
      brandKey: vehicle.brandKey,
      modelKey: vehicle.modelKey,
      yearValue: vehicle.year,
      dealerId: dealer?.id || 0
    }
  );

  return rows.map(mapAssistantPart);
}

function buildGenericSearchTerm(message, detectedGroups) {
  if (detectedGroups.length) {
    const matchedTemplates = partTemplates.filter((template) => detectedGroups.includes(template.groupKey));
    return matchedTemplates[0]?.name || message;
  }
  return message;
}

async function fetchGenericParts(message, vehicle, dealer, detectedGroups) {
  const searchTerm = `%${buildGenericSearchTerm(message, detectedGroups)}%`;
  const rows = await query(
    `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.part_type AS partType,
        p.price,
        p.rating,
        p.stock_quantity AS stockQuantity,
        p.part_number AS partNumber,
        p.serial_number AS serialNumber,
        p.image_url AS imageUrl,
        b.id AS brandId,
        b.brand_key AS brandKey,
        b.name AS brandName,
        d.id AS dealerId,
        d.name AS dealerName,
        d.slug AS dealerSlug,
        MAX(m.id) AS modelId,
        MAX(m.model_key) AS modelKey,
        MAX(m.name) AS modelName,
        MAX(vy.year_value) AS yearValue
      FROM parts p
      INNER JOIN brands b
        ON b.id = p.brand_id
      INNER JOIN dealers d
        ON d.id = p.dealer_id
      LEFT JOIN part_compatibility pc
        ON pc.part_id = p.id
      LEFT JOIN models m
        ON m.id = pc.model_id
      LEFT JOIN vehicle_years vy
        ON vy.id = pc.vehicle_year_id
      WHERE p.active = 1
        AND (
          p.name LIKE :term
          OR p.part_number LIKE :term
          OR p.description LIKE :term
        )
        AND (:brandKey = '' OR b.brand_key = :brandKey)
        AND (:modelKey = '' OR m.model_key = :modelKey)
        AND (:yearValue = 0 OR vy.year_value = :yearValue)
        AND (:dealerId = 0 OR d.id = :dealerId)
      GROUP BY
        p.id,
        p.slug,
        p.name,
        p.part_type,
        p.price,
        p.rating,
        p.stock_quantity,
        p.part_number,
        p.serial_number,
        p.image_url,
        b.id,
        b.brand_key,
        b.name,
        d.id,
        d.name,
        d.slug
      ORDER BY p.rating DESC, p.name ASC
      LIMIT 8
    `,
    {
      term: searchTerm,
      brandKey: vehicle.brandKey || "",
      modelKey: vehicle.modelKey || "",
      yearValue: vehicle.year || 0,
      dealerId: dealer?.id || 0
    }
  );

  return rows.map(mapAssistantPart);
}

function filterPartsByGroups(parts, groupKeys) {
  if (!groupKeys.length) {
    return parts;
  }

  return parts.filter((part) => groupKeys.includes(part.groupKey));
}

function extractSerialNumber(message) {
  const match = String(message || "")
    .toUpperCase()
    .match(/\bSN[\s-]*[A-Z0-9]+(?:[\s-]+[A-Z0-9]+){2,}\b/);

  if (!match) {
    return "";
  }

  return match[0]
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

async function lookupPartBySerial(serialNumber) {
  if (!serialNumber) {
    return null;
  }

  const rows = await query(
    `
      SELECT
        sr.id AS registryId,
        COALESCE(sr.serial_number, p.serial_number) AS serialNumber,
        COALESCE(sr.registry_status, 'valid') AS registryStatus,
        COALESCE(sr.seller_name, d.name) AS sellerName,
        sr.notes AS registryNotes,
        p.id,
        p.slug,
        p.name,
        p.part_type AS partType,
        p.price,
        p.rating,
        p.stock_quantity AS stockQuantity,
        p.part_number AS partNumber,
        p.serial_number AS partSerialNumber,
        p.image_url AS imageUrl,
        b.id AS brandId,
        b.brand_key AS brandKey,
        b.name AS brandName,
        d.id AS dealerId,
        d.name AS dealerName,
        d.slug AS dealerSlug,
        MAX(m.id) AS modelId,
        MAX(m.model_key) AS modelKey,
        MAX(m.name) AS modelName,
        MAX(vy.year_value) AS yearValue
      FROM parts p
      LEFT JOIN serial_registry sr
        ON sr.part_id = p.id
       AND UPPER(sr.serial_number) = :serialNumber
      INNER JOIN brands b
        ON b.id = p.brand_id
      INNER JOIN dealers d
        ON d.id = p.dealer_id
      LEFT JOIN part_compatibility pc
        ON pc.part_id = p.id
      LEFT JOIN models m
        ON m.id = pc.model_id
      LEFT JOIN vehicle_years vy
        ON vy.id = pc.vehicle_year_id
      WHERE p.active = 1
        AND (
          UPPER(sr.serial_number) = :serialNumber
          OR UPPER(p.serial_number) = :serialNumber
        )
      GROUP BY
        sr.id,
        sr.serial_number,
        sr.registry_status,
        sr.seller_name,
        sr.notes,
        p.id,
        p.slug,
        p.name,
        p.part_type,
        p.price,
        p.rating,
        p.stock_quantity,
        p.part_number,
        p.serial_number,
        p.image_url,
        b.id,
        b.brand_key,
        b.name,
        d.id,
        d.name,
        d.slug
      LIMIT 1
    `,
    { serialNumber }
  );

  if (!rows[0]) {
    return null;
  }

  const row = {
    ...rows[0],
    serialNumber: rows[0].serialNumber || rows[0].partSerialNumber
  };
  const part = mapAssistantPart(row);
  const registryStatus = String(rows[0].registryStatus || "valid").toLowerCase();

  return {
    serialNumber,
    status: ["valid", "unverified", "suspicious"].includes(registryStatus) ? registryStatus : "unverified",
    title: registryStatus === "valid"
      ? "Valid"
      : registryStatus === "suspicious"
        ? "Suspicious"
        : "Unverified",
    registryMessage: registryStatus === "valid"
      ? "Matched in the official AutoFix dealer registry."
      : registryStatus === "suspicious"
        ? "The serial exists, but it is flagged for further review."
        : "The serial exists, but it still needs dealer-side validation.",
    recommendation: registryStatus === "valid"
      ? "Keep the invoice and continue with confidence."
      : registryStatus === "suspicious"
        ? "Do not complete the purchase before AutoFix support reviews the item."
        : "Ask the seller for invoice proof before buying.",
    sellerName: rows[0].sellerName || rows[0].dealerName || "",
    dealer: part.dealer,
    part
  };
}

function determineDiagnosisProfile(message) {
  const normalizedMessage = normalizeLooseText(message);
  return DIAGNOSIS_PROFILES.find((profile) =>
    profile.patterns.some((pattern) => normalizedMessage.includes(normalizeLooseText(pattern)))
  ) || null;
}

async function buildPartsSearchPayload({ locale, message, context }) {
  const serialNumber = extractSerialNumber(message);
  if (serialNumber) {
    const serialVerification = await lookupPartBySerial(serialNumber);

    return {
      intent: serialVerification
        ? `serial_verification:${serialVerification.status}`
        : "serial_verification:not_found",
      status: serialVerification?.status || "unverified",
      suggestedAction: serialVerification?.status === "valid" ? "verified_serial" : "report_suspicion",
      replyData: {
        vehicle: serialVerification?.part?.vehicle || {},
        dealer: serialVerification?.dealer || null,
        selectedPart: serialVerification?.part || null,
        detectedGroups: [],
        serialVerification: serialVerification || {
          serialNumber,
          status: "unverified",
          title: "Not found",
          registryMessage: "This serial was not found in the AutoFix official registry.",
          recommendation: "Do not rely on the seller claim only. Ask for invoice proof or report the serial for review.",
          sellerName: "",
          dealer: null,
          part: null
        },
        parts: serialVerification?.part ? [serialVerification.part] : []
      }
    };
  }

  const extractedVehicle = extractVehicleFromMessage(message);
  const vehicle = buildResolvedVehicle(context, extractedVehicle);
  const dealerScope = resolveDealerScopeFromVehicle(context, vehicle);
  const dealer = await resolveDealerByContext({
    dealerId: dealerScope.dealerId,
    dealerSlug: dealerScope.dealerSlug,
    brandKey: dealerScope.brandKey || vehicle.brandKey
  });
  const selectedPart = await resolveSelectedPart({
    partId: context.partId,
    partSlug: context.partSlug
  });
  const detectedGroups = detectPartGroups(message);
  const wantsCatalogBrowse = /available|all|show|browse|catalog|compatible|قطع|المتوفر|كل/i.test(message);

  if (!vehicle.brandKey || !vehicle.modelKey || !vehicle.year) {
    return {
      intent: detectedGroups[0] ? `parts_search:${detectedGroups[0]}` : "parts_search:vehicle_required",
      status: "pending",
      suggestedAction: "ask_vehicle",
      replyData: {
        vehicle,
        dealer,
        selectedPart,
        detectedGroups,
        parts: []
      }
    };
  }

  const compatibleParts = await fetchCompatiblePartsForVehicle(vehicle, dealer);
  let parts = wantsCatalogBrowse && !detectedGroups.length
    ? compatibleParts.slice(0, 6)
    : filterPartsByGroups(compatibleParts, detectedGroups);

  if (!parts.length) {
    const genericParts = await fetchGenericParts(message, vehicle, dealer, detectedGroups);
    parts = detectedGroups.length ? filterPartsByGroups(genericParts, detectedGroups) : genericParts;
  }

  if (!parts.length) {
    return {
      intent: detectedGroups[0] ? `parts_search:${detectedGroups[0]}` : "parts_search:no_match",
      status: "completed",
      suggestedAction: "verify_fitment",
      replyData: {
        vehicle,
        dealer,
        selectedPart,
        detectedGroups,
        parts: []
      }
    };
  }

  return {
    intent: detectedGroups[0] ? `parts_search:${detectedGroups[0]}` : wantsCatalogBrowse ? "parts_search:catalog_overview" : "parts_search:general_match",
    status: "completed",
    suggestedAction: "show_results",
    replyData: {
      vehicle,
      dealer,
      selectedPart,
      detectedGroups,
      parts: parts.slice(0, 5)
    }
  };
}

async function buildDiagnosisPayload({ locale, message, context }) {
  const extractedVehicle = extractVehicleFromMessage(message);
  const vehicle = buildResolvedVehicle(context, extractedVehicle);
  const dealerScope = resolveDealerScopeFromVehicle(context, vehicle);
  const dealer = await resolveDealerByContext({
    dealerId: dealerScope.dealerId,
    dealerSlug: dealerScope.dealerSlug,
    brandKey: dealerScope.brandKey || vehicle.brandKey
  });
  const selectedPart = await resolveSelectedPart({
    partId: context.partId,
    partSlug: context.partSlug
  });
  const diagnosisProfile = determineDiagnosisProfile(message);

  if (!diagnosisProfile) {
    return {
      intent: "fault_diagnosis:clarify",
      status: "pending",
      suggestedAction: "ask_clarifying_question",
      replyData: {
        vehicle,
        dealer,
        selectedPart,
        severity: "moderate",
        likelyIssues: locale === "ar-eg"
          ? ["محتاج أعرف العرض الأساسي: العربية مش بتدور، ولا فيها سخونة، ولا صوت، ولا رعشة؟"]
          : ["I need one main symptom first: not starting, overheating, brake issue, smoke, or vibration/noise?"],
        parts: [],
        nextSteps: locale === "ar-eg"
          ? ["قولّي أهم عرض ظاهر دلوقتي وساعتها أقولك أقرب احتمال والخطوة اللي بعدها."]
          : ["Tell me the main symptom and I will narrow the likely cause and next step."]
      }
    };
  }

  let suggestedParts = [];
  if (vehicle.brandKey && vehicle.modelKey && vehicle.year) {
    const compatibleParts = await fetchCompatiblePartsForVehicle(vehicle, dealer);
    suggestedParts = filterPartsByGroups(compatibleParts, diagnosisProfile.relatedPartGroups || []).slice(0, 3);
  }

  const nextSteps = locale === "ar-eg"
    ? buildArabicNextSteps(diagnosisProfile.severity, dealer)
    : buildEnglishNextSteps(diagnosisProfile.severity, dealer);

  return {
    intent: `fault_diagnosis:${diagnosisProfile.key}`,
    status: diagnosisProfile.severity === "urgent" ? "escalated" : "completed",
    suggestedAction: diagnosisProfile.suggestedAction,
    replyData: {
      vehicle,
      dealer,
      selectedPart,
      severity: diagnosisProfile.severity,
      likelyIssues: diagnosisProfile.likelyIssues[locale] || diagnosisProfile.likelyIssues.en,
      parts: suggestedParts,
      nextSteps
    }
  };
}

function buildEnglishNextSteps(severity, dealer) {
  const steps = [];
  if (severity === "urgent") {
    steps.push("Do not keep driving the car until the issue is inspected.");
    steps.push("Arrange towing or urgent workshop support if the car is unsafe.");
  } else if (severity === "moderate") {
    steps.push("Book an inspection before replacing multiple parts blindly.");
    steps.push("Check warning lights, unusual sounds, and recent service history.");
  } else {
    steps.push("Monitor the symptom and plan a service check soon.");
  }

  if (dealer?.name) {
    steps.push(`If you want an official route, start with ${dealer.name}.`);
  }
  return steps;
}

function buildArabicNextSteps(severity, dealer) {
  const steps = [];
  if (severity === "urgent") {
    steps.push("ما تكملش سواقة بالعربية قبل ما تتفحص.");
    steps.push("لو العربية مش أمان أو فيها سخونة/فرامل، الأفضل سحب أو فحص عاجل.");
  } else if (severity === "moderate") {
    steps.push("اعمل فحص الأول قبل ما تغيّر أكتر من قطعة عشوائي.");
    steps.push("راجع اللمبات اللي ظهرت والصوت أو الرعشة وإمتى بدأت.");
  } else {
    steps.push("راقب العَرَض وحدد معاد صيانة قريب.");
  }

  if (dealer?.name) {
    steps.push(`ولو عايز تمشي رسمي، ابدأ مع ${dealer.name}.`);
  }
  return steps;
}

function buildDeterministicPartsReply(locale, payload) {
  const isArabic = locale === "ar-eg";
  const vehicle = payload.replyData?.vehicle || {};
  const parts = payload.replyData?.parts || [];
  const detectedGroups = payload.replyData?.detectedGroups || [];
  const missingFields = getMissingVehicleFields(vehicle);
  const vehicleLabel = getVehicleLabelForReply(vehicle, locale);
  const groupLabel = getPartGroupLabel(detectedGroups[0], locale) || (isArabic ? "القطعة" : "the part");
  const serialVerification = payload.replyData?.serialVerification || null;

  if (serialVerification) {
    const part = serialVerification.part;

    if (serialVerification.status === "valid" && part) {
      if (isArabic) {
        return `السيريال ${serialVerification.serialNumber} أصلي وموجود في AutoFix. القطعة هي ${part.name}، السعر ${part.price} جنيه، والتوكيل ${part.dealer?.name || serialVerification.sellerName || "AutoFix"}. تقدر تراجع تفاصيلها من الكارت اللي تحت، وخلي الفاتورة معاك بعد الشراء.`;
      }

      return `Serial ${serialVerification.serialNumber} is valid and matched in AutoFix. The part is ${part.name}, priced at ${part.price} EGP, from ${part.dealer?.name || serialVerification.sellerName || "AutoFix"}. Open the card below to review the product details.`;
    }

    if (serialVerification.status === "suspicious") {
      return isArabic
        ? `السيريال ${serialVerification.serialNumber} موجود، بس عليه علامة مراجعة. الأفضل ما تكملش الشراء قبل ما AutoFix يراجعه أو تتأكد من الفاتورة والتغليف.`
        : `Serial ${serialVerification.serialNumber} exists, but it is flagged for review. Do not complete the purchase before AutoFix reviews it or you confirm the invoice and packaging.`;
    }

    return isArabic
      ? `السيريال ${serialVerification.serialNumber} مش متأكد عندنا كقطعة أصلية دلوقتي. اطلب فاتورة واضحة من البائع، ولو حابب ابعت بلاغ مراجعة من صفحة Verify.`
      : `Serial ${serialVerification.serialNumber} is not confirmed as a valid original part right now. Ask the seller for invoice proof, or report it from the Verify page for review.`;
  }

  if (payload.status === "pending") {
    if (isArabic) {
      if (missingFields.length === 1 && missingFields[0] === "year") {
        return `تمام، معايا ${groupLabel} والماركة والموديل. ابعتلي سنة العربية بس وأنا أدور لك مباشرة في القطع المتوفرة.`;
      }
      if (missingFields.length === 1 && missingFields[0] === "model") {
        return `تمام، محتاج موديل العربية بس مع ${String(vehicle.brandKey || "").toUpperCase()} عشان أطلع لك ${groupLabel} المتوافق.`;
      }
      if (missingFields.length === 1 && missingFields[0] === "brand") {
        return `تمام، محتاج الماركة بس مع الموديل والسنة عشان أطلع لك ${groupLabel} المتوافق من الكاتالوج.`;
      }
      return "ابعتلي اسم القطعة مع الماركة والموديل والسنة، وأنا أدور لك مباشرة في القطع المتوفرة عندنا من غير ما تحتاج رقم شاسيه أو فئة.";
    }

    if (missingFields.length === 1 && missingFields[0] === "year") {
      return `I have the ${groupLabel}, brand, and model. I only need the year to search the available compatible results directly.`;
    }

    return "Send the part name with brand, model, and year, and I will search the AutoFix catalog directly without needing VIN or trim for a basic fitment search.";
  }

  if (!parts.length) {
    if (isArabic) {
      return `دورت لك على ${groupLabel} لـ ${vehicleLabel} في كاتالوج AutoFix، ومفيش نتيجة متاحة دلوقتي. جرّب سنة تانية أو قطعة تانية، وأنا أكمل معاك على طول.`;
    }

    return `I searched the AutoFix catalog for ${groupLabel} for ${vehicleLabel}, but there is no available result right now. Try another year or another part name and I will keep searching.`;
  }

  const topPart = parts[0];
  if (isArabic) {
    return `لقيت لك ${parts.length} نتيجة متوافقة لـ ${groupLabel} بتاعة ${vehicleLabel}. أقرب اختيار ظاهر دلوقتي هو ${topPart.name} بسعر ${topPart.price} جنيه، وشوف البطاقات اللي تحت عشان تقارن بين المتاح عندنا.`;
  }

  return `I found ${parts.length} compatible result(s) for ${groupLabel} for ${vehicleLabel}. The closest match right now is ${topPart.name} at ${topPart.price} EGP. Check the cards below to compare the available options.`;
}

function shouldRejectOpenAIPartsReply(reply, payload) {
  const normalizedReply = normalizeLooseText(reply);
  const vehicle = payload.replyData?.vehicle || {};
  const missingFields = getMissingVehicleFields(vehicle);
  const hasParts = Array.isArray(payload.replyData?.parts) && payload.replyData.parts.length > 0;

  const asksForOverkillFitment = [
    "vin",
    "chassis",
    "رقم شاسيه",
    "الشاسيه",
    "trim",
    "sub variant",
    "variant",
    "الفئه",
    "الفئة"
  ].some((token) => normalizedReply.includes(normalizeLooseText(token)));

  if (!missingFields.length && asksForOverkillFitment) {
    return true;
  }

  const claimsNoResults = [
    "no available result",
    "no result",
    "no match",
    "not available",
    "مفيش نتيجة",
    "مفيش قطع",
    "مش متاح"
  ].some((token) => normalizedReply.includes(normalizeLooseText(token)));

  if (hasParts && claimsNoResults) {
    return true;
  }

  return false;
}

function buildFallbackReply({ locale, mode, message, payload }) {
  const isArabic = locale === "ar-eg";

  if (mode === "parts_search") {
    return buildDeterministicPartsReply(locale, payload);
  }

  const severityLabels = {
    en: {
      urgent: "urgent",
      moderate: "moderate",
      minor: "minor"
    },
    "ar-eg": {
      urgent: "مستوى عاجل",
      moderate: "مستوى متوسط",
      minor: "مستوى بسيط"
    }
  };

  const severityLabel = severityLabels[locale][payload.replyData.severity] || payload.replyData.severity;
  const firstIssue = payload.replyData.likelyIssues[0] || "";

  if (isArabic) {
    return `ده تشخيص مبدئي بس: أقرب احتمال هو ${firstIssue}، ومستوى الحالة ${severityLabel}. هتلاقي تحت الخطوات المقترحة، ولو في قطع مناسبة للعربية هتظهر لك كمان.`;
  }

  return `This is only a preliminary diagnosis: the closest likely issue is ${firstIssue}, and the case looks ${severityLabel}. You will find the recommended next steps below, and any relevant compatible parts will appear as well.`;
}

function buildOpenAIInput({ locale, mode, message, history, payload }) {
  return [
    `Mode: ${mode}`,
    `Locale: ${locale}`,
    `Recent conversation:\n${summarizeHistory(history) || "No previous messages."}`,
    `Current user message:\n${message}`,
    `Grounded facts:\n${JSON.stringify(payload.replyData, null, 2)}`,
    "Write only the final assistant reply for the website chat. Do not output JSON."
  ].join("\n\n");
}

async function renderReplyWithOpenAI({ locale, mode, message, history, payload }) {
  if (!openaiClient) {
    return null;
  }

  const response = await openaiClient.responses.create({
    model: env.openai.assistantModel,
    instructions: buildAssistantInstructions({ locale, mode }),
    input: buildOpenAIInput({ locale, mode, message, history, payload }),
    max_output_tokens: 420
  });

  return String(response.output_text || "").trim();
}

function buildStatusLabel(mode, payload) {
  if (mode === "fault_diagnosis") {
    return payload.replyData?.severity || "moderate";
  }
  return payload.status;
}

function normalizeAssistantLogStatus(status) {
  return ["completed", "escalated", "pending"].includes(status) ? status : "completed";
}

async function persistAssistantLog({ user, mode, locale, message, replyText, payload }) {
  const dealerId = payload.replyData?.dealer?.id
    || payload.replyData?.parts?.[0]?.dealer?.id
    || null;

  const result = await query(
    `
      INSERT INTO assistant_logs (
        user_id,
        dealer_id,
        session_type,
        intent,
        user_message,
        assistant_response,
        status,
        locale_code,
        suggested_action,
        context_snapshot
      )
      VALUES (
        :userId,
        :dealerId,
        :sessionType,
        :intent,
        :userMessage,
        :assistantResponse,
        :status,
        :localeCode,
        :suggestedAction,
        :contextSnapshot
      )
    `,
    {
      userId: user?.id || null,
      dealerId,
      sessionType: mode === "fault_diagnosis" && payload.suggestedAction === "tow_truck"
        ? "service_recommendation"
        : mode,
      intent: payload.intent,
      userMessage: message,
      assistantResponse: replyText,
      status: normalizeAssistantLogStatus(payload.status),
      localeCode: locale,
      suggestedAction: payload.suggestedAction || null,
      contextSnapshot: JSON.stringify(payload.replyData || {})
    }
  );

  return Number(result.insertId);
}

function mapHistoryRow(row) {
  let data = {};
  try {
    data = row.contextSnapshot ? JSON.parse(row.contextSnapshot) : {};
  } catch {
    data = {};
  }

  return {
    id: Number(row.id),
    locale: row.localeCode || "en",
    mode: row.sessionType === "service_recommendation" ? "fault_diagnosis" : row.sessionType,
    intent: row.intent || "",
    status: row.status,
    suggestedAction: row.suggestedAction || "",
    createdAt: row.createdAt,
    userMessage: row.userMessage,
    assistantResponse: row.assistantResponse,
    data
  };
}

export async function listAssistantHistory(userId, filters = {}) {
  const locale = normalizeAssistantLocale(filters.locale);
  const mode = normalizeAssistantMode(filters.mode);
  const modeClause = !filters.mode
    ? ""
    : mode === "fault_diagnosis"
      ? " AND session_type IN ('fault_diagnosis', 'service_recommendation') "
      : " AND session_type = :mode ";
  const rows = await query(
    `
      SELECT
        id,
        session_type AS sessionType,
        intent,
        user_message AS userMessage,
        assistant_response AS assistantResponse,
        status,
        locale_code AS localeCode,
        suggested_action AS suggestedAction,
        context_snapshot AS contextSnapshot,
        created_at AS createdAt
      FROM assistant_logs
      WHERE user_id = :userId
        AND (:locale = '' OR locale_code = :locale)
        ${modeClause}
      ORDER BY created_at DESC, id DESC
      LIMIT 12
    `,
    {
      userId,
      locale: filters.locale ? locale : "",
      mode: filters.mode ? mode : ""
    }
  );

  return rows.map(mapHistoryRow);
}

export async function getAssistantBootstrapData(user) {
  const base = buildStarterPayload();
  return {
    ...base,
    liveModel: Boolean(env.openai.apiKey),
    model: env.openai.assistantModel,
    history: user ? await listAssistantHistory(user.id) : [],
    viewer: user
      ? {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        dashboardAccess: user.dashboardAccess,
        savedVehicle: user.savedVehicle || null
      }
      : null
  };
}

export async function processAssistantChat({ user = null, locale, mode, message, context = {}, history = [] }) {
  const normalizedLocale = normalizeAssistantLocale(locale);
  const normalizedMode = normalizeAssistantMode(mode);
  const trimmedMessage = String(message || "").trim();

  if (!trimmedMessage) {
    const error = new Error("Message is required");
    error.statusCode = 400;
    throw error;
  }

  const normalizedContext = {
    brandKey: normalizeBrandKey(context.brandKey || ""),
    modelKey: String(context.modelKey || "").trim().toLowerCase(),
    modelName: String(context.modelName || context.vehicleName || "").trim(),
    year: Number(context.year || 0) || null,
    dealerId: Number(context.dealerId || 0) || null,
    dealerSlug: String(context.dealerSlug || "").trim(),
    partId: Number(context.partId || 0) || null,
    partSlug: String(context.partSlug || "").trim(),
    page: String(context.page || "").trim()
  };

  const payload = normalizedMode === "fault_diagnosis"
    ? await buildDiagnosisPayload({ locale: normalizedLocale, message: trimmedMessage, context: normalizedContext })
    : await buildPartsSearchPayload({ locale: normalizedLocale, message: trimmedMessage, context: normalizedContext });
  const forceDeterministicReply = normalizedMode === "parts_search"
    && (
      String(payload.intent || "").startsWith("serial_verification:")
      || (Array.isArray(payload.replyData?.parts) && payload.replyData.parts.length > 0)
    );

  let reply = null;
  let provider = "fallback";

  if (!forceDeterministicReply) {
    try {
      reply = await renderReplyWithOpenAI({
        locale: normalizedLocale,
        mode: normalizedMode,
        message: trimmedMessage,
        history,
        payload
      });
      if (reply) {
        if (normalizedMode === "parts_search" && shouldRejectOpenAIPartsReply(reply, payload)) {
          reply = null;
        } else {
          provider = "openai";
        }
      }
    } catch {
      reply = null;
    }
  }

  if (!reply) {
    reply = buildFallbackReply({
      locale: normalizedLocale,
      mode: normalizedMode,
      message: trimmedMessage,
      payload
    });
  }

  reply = normalizeAssistantReplyText(reply, normalizedLocale);

  const logId = await persistAssistantLog({
    user,
    mode: normalizedMode,
    locale: normalizedLocale,
    message: trimmedMessage,
    replyText: reply,
    payload
  });

  return {
    id: logId,
    locale: normalizedLocale,
    mode: normalizedMode,
    provider,
    liveModel: Boolean(env.openai.apiKey),
    reply,
    status: payload.status,
    statusLabel: buildStatusLabel(normalizedMode, payload),
    suggestedAction: payload.suggestedAction,
    intent: payload.intent,
    data: payload.replyData
  };
}
