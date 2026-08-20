import { looksLikeThemeRequest, resolveColor } from "../www/theme.js";
import { pickJob, orderFor, describeChain, skipLocalModel } from "../www/command.js";
import { isDenverFallback, validCoord } from "../www/geo.js";
import { substanceScore } from "../www/memory.js";
import { isBlank, FALLBACK } from "../www/crew.js";
import { looksLikeMealRequest } from "../www/meals.js";
import { extractGuideQuery } from "../www/guide.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(looksLikeThemeRequest("make it pink"), "make it pink");
assert(looksLikeThemeRequest("go pink"), "go pink");
assert(looksLikeThemeRequest("pink"), "pink");
assert(looksLikeThemeRequest("too green, go warmer"), "warmer");
assert(looksLikeThemeRequest("paint the ui cobalt"), "cobalt");
assert(!looksLikeThemeRequest("apply to the pink festival call"), "festival false positive");
assert(resolveColor("make it pink") === "#ff69b4", "pink hex");
assert(isDenverFallback(39.7392, -104.9903), "denver detect");
assert(!isDenverFallback(30.2672, -97.7431), "austin not denver");
assert(validCoord(30.26, -97.74), "valid coord");
assert(pickJob("write a cover letter") === "boost", "boost job");
assert(pickJob("hey") === "life", "life job");
assert(pickJob("fix this javascript bug") === "code", "code job");
assert(JSON.stringify(orderFor("life", ["groq", "gemini"], { groq: { ok: false }, gemini: { ok: true } })) === JSON.stringify(["gemini", "groq"]), "health order");
assert(skipLocalModel({ brain_pin: "auto" }) === true, "skip qwen");
assert(skipLocalModel({ brain_pin: "local" }) === false, "allow qwen pin");
const strip = describeChain(["groq"], { groq: { ok: true } }, false, "auto");
assert(strip.find((r) => r.id === "groq").state === "on", "groq on");
assert(strip.find((r) => r.id === "gemini").state === "off", "gemini off");
assert(substanceScore("yeah") === 0, "noise");
assert(substanceScore("I want to build Holowatts because live rooms saved me") > 20, "story");
assert(!isBlank("Pip is happy to help."), "voice not blank");
assert(/happy to help/i.test(FALLBACK), "fallback greeting");
assert(looksLikeMealRequest("plan my meals today"), "meal detect");
assert(extractGuideQuery("what is the aurora borealis") === "aurora borealis", "guide query");
await import("../www/oppdesk.js");
console.log("ok", 21);
