"use strict";

const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const axios = require("axios");

const homepageUrl = "https://www.corkgigs.com/";
const snapshotPath = path.join(__dirname, "demo-data", "corkgigs-2026-05-13.html");

function readSnapshot() {
  let html;
  try {
    html = fs.readFileSync(snapshotPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read archived CorkGigs snapshot at ${snapshotPath}: ${error.message}`
    );
  }

  const $ = cheerio.load(html);
  const rows = $("tr.event");
  const cleanText = value => value.replace(/\s+/g, " ").trim();
  const firstDate = cleanText(rows.first().find("td").eq(0).text());
  const validRows = rows.toArray().every(row => {
    const cells = $(row).find("td");
    return (
      cells.length >= 5 &&
      cleanText(cells.eq(0).text()) &&
      cleanText(cells.eq(2).text()) &&
      cleanText(cells.eq(3).text())
    );
  });

  if (
    rows.length !== 203 ||
    firstDate !== "Thu 14 May 2026" ||
    !validRows
  ) {
    throw new Error(
      `Invalid archived CorkGigs snapshot at ${snapshotPath}: expected 203 ` +
      "tr.event rows with date, title and venue, starting Thu 14 May 2026; " +
      `found ${rows.length} rows, first date "${firstDate}".`
    );
  }

  return html;
}

function main() {
  // Validate before loading the server; a missing/invalid archive never goes live.
  const html = readSnapshot();
  process.chdir(__dirname);
  process.env.PORT = process.env.PORT || "3001";

  // server.js receives this same CommonJS Axios object.
//
// Demo behaviour:
// 1. The CorkGigs homepage is served from the archived HTML snapshot.
// 2. Any other CorkGigs URL is blocked immediately so the demo never waits
//    for the unavailable live website.
// 3. Other services such as Eventbrite, Nominatim and OSRM continue normally.

const originalGet = axios.get;

function isCorkGigsUrl(value) {
  try {
    const parsed = new URL(String(value));
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    return hostname === "corkgigs.com";
  } catch {
    return false;
  }
}

axios.get = function archiveDemoGet(url, config) {
  if (url === homepageUrl) {
    return Promise.resolve({
      data: html,
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/html; charset=utf-8"
      },
      config: {
        ...config,
        method: "get",
        url
      },
      request: null
    });
  }

  if (isCorkGigsUrl(url)) {
    const error = new Error(
      `Live CorkGigs request blocked in Open Day demo: ${url}`
    );

    error.code = "VIBELLEE_ARCHIVE_DEMO";
    return Promise.reject(error);
  }

  return originalGet.apply(this, arguments);
};

  console.log(
  "[VibeLee archive demo] Using CorkGigs snapshot from 13 May 2026 " +
  "(203 event rows; first event 14 May 2026). " +
  `Port: ${process.env.PORT}.`
);
  require(path.join(__dirname, "server.js"));
}

try {
  main();
} catch (error) {
  console.error(`[VibeLee archive demo] Startup failed: ${error.message}`);
  process.exitCode = 1;
}
