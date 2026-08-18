const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const html = path.join(__dirname, "store-assets.html");
const output = path.join(root, "assets");
fs.mkdirSync(output, { recursive: true });

const stories = ["market", "h100", "supplier", "swap", "kline", "assessment"];
const jobs = [];

stories.forEach((story, i) => {
  const n = String(i + 1).padStart(2, "0");
  jobs.push({ name: `ios-${n}-${story}-1290x2796.png`, width: 1290, height: 2796, query: `type=portrait&platform=ios&story=${story}` });
  jobs.push({ name: `android-${n}-${story}-1080x1920.png`, width: 1080, height: 1920, query: `type=portrait&platform=android&story=${story}` });
});

jobs.push(
  { name: "tablet-01-operations-2732x2048.png", width: 2732, height: 2048, query: "type=tablet&story=supplier&image=../../outputs/marketplace-operations-desktop.png" },
  { name: "tablet-02-kline-2732x2048.png", width: 2732, height: 2048, query: "type=tablet&story=kline" },
  { name: "feature-graphic-1024x500.png", width: 1024, height: 500, query: "type=feature" },
  { name: "launch-iphone-1290x2796.png", width: 1290, height: 2796, query: "type=launch" },
  { name: "launch-android-1440x3120.png", width: 1440, height: 3120, query: "type=launch" },
  { name: "launch-tablet-2732x2048.png", width: 2732, height: 2048, query: "type=launch&orientation=landscape" }
);

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

(async () => {
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const launchOptions = { headless: true };
  if (fs.existsSync(edgePath)) launchOptions.executablePath = edgePath;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const job of jobs) {
    await page.setViewportSize({ width: job.width, height: job.height });
    await page.goto(`${fileUrl(html)}?${job.query}`, { waitUntil: "load" });
    await page.waitForFunction(() => Array.from(document.images).every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(output, job.name), fullPage: false });
  }

  await page.setViewportSize({ width: 1800, height: 1920 });
  await page.goto(`${fileUrl(html)}?type=contact`, { waitUntil: "load" });
  await page.waitForFunction(() => Array.from(document.images).every(img => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, "preview-contact-sheet.png"), fullPage: true });

  await browser.close();
  console.log(`Rendered ${jobs.length + 1} assets to ${output}`);
})();
