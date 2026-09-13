import assert from "node:assert/strict";
import { test } from "node:test";
import { publicationMarkets } from "../src/publication.js";

test("publisher only includes supported work locations with explicit evidence", () => {
  const cases: [string, string[]][] = [
    ["Atlanta, GA", ["us"]], ["Remote - US", ["us"]], ["USA - Remote", ["us"]],
    ["Bengaluru, Karnataka, India", ["in"]], ["Remote (India)", ["in"]],
    ["New York or Bengaluru", ["us", "in"]], ["New York, Bengaluru", ["in", "us"]],
    ["Remote — Worldwide", ["us", "in"]], ["Remote", []], ["APAC Remote", []],
    ["London, United Kingdom", []], ["Dubai, UAE", []], ["Berlin, DE", []],
    ["Toronto, CA", []], ["Vancouver, Canada", []], ["Vancouver, WA", ["us"]],
    ["Indiana", ["us"]], ["Delhi, NY", ["us"]], ["New Delhi, Ontario, Canada", []],
    ["Remote worldwide, excluding USA", []], ["Georgia", []],
  ];
  for (const [location, expected] of cases) assert.deepEqual(publicationMarkets(location), expected, location);
});

test("mixed supported and unsupported locations never add a third market", () => {
  assert.deepEqual(publicationMarkets("London, UK | Bengaluru, India | Austin, TX"), ["in", "us"]);
  assert.deepEqual(publicationMarkets("Singapore; Germany; Canada"), []);
});

test("structured country evidence takes precedence over ambiguous city names", () => {
  assert.deepEqual(publicationMarkets("Panaji, Goa, in", ["in"]), ["in"]);
  assert.deepEqual(publicationMarkets("Delhi", ["US"]), ["us"]);
  assert.deepEqual(publicationMarkets("London", ["US"]), ["us"]);
  assert.deepEqual(publicationMarkets("New Delhi", ["CA"]), []);
  assert.deepEqual(publicationMarkets("Remote", ["us", "in", "gb"]), ["us", "in"]);
});
