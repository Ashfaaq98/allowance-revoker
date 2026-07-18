import puppeteer from "puppeteer-core";

const SP = "/tmp/claude-1000/-home-ashfaaq-Hackathons-Build-Anything-Spark/1bb86b48-371c-44b8-a0e3-b76712089b16/scratchpad";
const target = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] ?? 1440);
const height = Number(process.argv[5] ?? 900);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  defaultViewport: {width, height},
});
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [console error]", m.text().slice(0,160)); });
page.on("pageerror", (e) => console.log("  [page error]", String(e).slice(0,200)));

await page.goto(target, {waitUntil: "networkidle2", timeout: 60000});

// Wait for the scan to finish: either rows appear or an empty/error notice does.
try {
  await page.waitForFunction(
    () => document.querySelector("tbody tr") || /Nothing exposed|Scan failed|No scan yet/.test(document.body.innerText),
    {timeout: 90000, polling: 500},
  );
} catch { console.log("  (timed out waiting for scan to settle)"); }

await new Promise((r) => setTimeout(r, 1200));
const rows = await page.$$eval("tbody tr", (t) => t.length).catch(() => 0);
const text = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 400));
console.log(`  rows rendered: ${rows}`);
console.log(`  page text: ${text}`);
await page.screenshot({path: `${SP}/${out}`});
console.log(`  saved ${out}`);
await browser.close();
