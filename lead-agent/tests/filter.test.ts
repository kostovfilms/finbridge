import { describe, expect, it } from "vitest";
import { analyzeByKeywords, detectIntent, detectLocation, detectNiche } from "../src/filter.js";
import { testConfig } from "./helpers.js";

const cfg = testConfig();
const S = cfg.seekerPhrases;
const O = cfg.offerPhrases;

describe("търсещ или предлагащ", () => {
  it.each([
    "Търся видеограф за сватба в Пловдив",
    "Здравейте, нужен ми е оператор за събитие",
    "Кой снима клипове? Трябва ми музикален клип",
    "Looking for a 3D artist for product animation",
    "We need a CGI ad for our new sneaker",
    "[Hiring] 3D explainer video for SaaS",
    "Търсим снимачен екип. Предлагаме добро заплащане.",
  ])("търси: %s", (t) => {
    expect(detectIntent(t, S, O).seeker).toBe(true);
  });

  it.each([
    "Предлагам заснемане на рекламно видео. Търся клиенти!",
    "Търся работа като оператор",
    "[For Hire] 3D product animation, check out my portfolio",
    "Looking for work as a 3D animator",
    "Looking for new clients! I offer CGI ads",
    "Снимаме музикални клипове, цени от 300 лв",
  ])("не търси: %s", (t) => {
    expect(detectIntent(t, S, O).seeker).toBe(false);
  });

  it("фразата за търсене трябва да е цяла дума отляво", () => {
    // „натърсях“ не е „търся“
    expect(detectIntent("Натърсях се из сайта, видеото е готово", S, O).seeker).toBe(false);
  });
});

describe("ниша, пазар и място", () => {
  it("български текст → bg, по-конкретната ниша печели", () => {
    const m = detectNiche("Търся кой да заснеме музикален клип и видео", cfg.markets);
    expect(m?.market.id).toBe("bg");
    expect(m?.niche).toBe("Музикален клип");
  });

  it("английски текст → us", () => {
    const m = detectNiche("Need a 3D product animation for Amazon listing", cfg.markets);
    expect(m?.market.id).toBe("us");
    expect(m?.niche).toBe("3D Product Animation");
  });

  it("град от списъка или държавата по подразбиране", () => {
    const bg = cfg.markets.find((m) => m.id === "bg")!;
    expect(detectLocation("Търся оператор във Варна", cfg, bg)).toBe("Варна");
    expect(detectLocation("Търся оператор", cfg, bg)).toBe("България");
  });

  it("пълен анализ: търсене без ключова дума за услугата не е заявка", () => {
    expect(analyzeByKeywords("Търся апартамент под наем", cfg).isLead).toBe(false);
    expect(analyzeByKeywords("Търся оператор за фирмено видео", cfg).isLead).toBe(true);
  });
});
