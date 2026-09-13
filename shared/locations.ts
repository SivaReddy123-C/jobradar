import { type Market } from "./search.js";

const INDIA_CITIES = /\b(bengaluru|bangalore|hyderabad|chennai|mumbai|pune|gurgaon|gurugram|noida|delhi|kolkata|ahmedabad|kochi|thiruvananthapuram|trivandrum|jaipur|indore|coimbatore)\b/i;
const US_CITIES = /\b(new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|dallas|miami|washington)\b/i;
const US_STATE_CODE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const US_STATES = /\b(california|texas|florida|massachusetts|illinois|indiana|pennsylvania|ohio|colorado|arizona|new jersey|north carolina|south carolina|virginia|maryland|michigan|minnesota|wisconsin|oregon|tennessee|utah|nevada)\b/i;
const FOREIGN_LOCATION = /\b(canada|toronto|montreal|ottawa|ontario|united kingdom|uk|england|germany|netherlands|france|spain|italy|australia|singapore|japan|uae|united arab emirates|dubai|switzerland|ireland|berlin)\b/i;

/** Conservative work-location evidence. Never use employer headquarters. */
export function publicationMarkets(location: string, countryCodes?: string[]): Market[] {
  if (countryCodes) return [...new Set(countryCodes.flatMap((code): Market[] => {
    const country = code.trim().toLowerCase();
    return ["us", "usa", "united states"].includes(country) ? ["us"] : ["in", "ind", "india"].includes(country) ? ["in"] : [];
  }))];
  if (/\b(except|excluding|outside)\b/i.test(location)) return [];
  if (/\b(worldwide|anywhere in the world|global remote|remote global)\b/i.test(location)) return ["us", "in"];
  const markets = new Set<Market>();
  for (const part of location.split(/[;|]|\s+or\s+|\s+and\s+/i)) {
    const us = /\b(united states|usa|us)\b|\bu\.s\./i.test(part);
    const india = /\bindia\b/i.test(part); // "Indiana" is not India.
    if (us) markets.add("us");
    if (india) markets.add("in");
    if (us || india || FOREIGN_LOCATION.test(part)) continue;
    if (US_STATE_CODE.test(part) || US_STATES.test(part)) { markets.add("us"); continue; }
    if (INDIA_CITIES.test(part)) markets.add("in");
    if (US_CITIES.test(part)) markets.add("us");
  }
  return [...markets];
}
