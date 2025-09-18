// scanScoreSheet.js
const puppeteer = require("puppeteer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");
const { corsHeaders } = require("../headers");
const { Mutex } = require('async-mutex');
const validateScanScoreSheet = require("../validators/validateScanScoreSheet");

const NOTAMATE_URL = "https://www.notamate.com/convert";
const NOTAMATE_SIGN_IN_URL = "https://www.notamate.com/auth/signin";

async function loginToNotamate(page) {
  await page.goto(NOTAMATE_SIGN_IN_URL, { waitUntil: "networkidle2" });
  await page.type("input[name='email']", process.env.NOTAMATE_EMAIL, { delay: 50 });
  await page.type("input[name='password']", process.env.NOTAMATE_PASSWORD, { delay: 50 });
  await page.click("button[type='submit']");
  await page.waitForNavigation({ waitUntil: "networkidle2" });
`  console.log("[Notamate] Login successful");
`}

const mutex = new Mutex(1);

async function clickNext(page, labelText) {
  const stepBtnSelector =
    "button[data-testid='step-navigation-next'] span[data-testid='step-navigation-next-label']";
  await page.waitForFunction(
    (sel, text) => {
      const btn = document.querySelector(sel);
      return btn && btn.textContent === text && !btn.closest("button").disabled;
    },
    {},
    stepBtnSelector,
    labelText
  );
  await page.click(stepBtnSelector);
  console.log(`[PGN] Step "${labelText}" clicked`);
}

async function setCropToFullImage(page) {
  await page.waitForSelector(".ReactCrop__drag-handle.ord-nw");
  await page.waitForSelector(".ReactCrop__drag-handle.ord-ne");

  // NOTE: This is a workaround. By adding a padding bottom for the image wrapper div
  await page.evaluate(() => {
    const wrapper = document.querySelector('.ReactCrop__child-wrapper');
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      const padding = rect.height * 0.11; // 11% of height
      wrapper.style.paddingBottom = `${padding}px`;
    }
  });
  const imageBox = await page.$eval(".ReactCrop", (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

  // Drag NW handle to top-left
  const nwHandle = await page.$(".ReactCrop__drag-handle.ord-nw");
  const nwBox = await nwHandle.boundingBox();
  await page.mouse.move(nwBox.x + nwBox.width / 2, nwBox.y + nwBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(imageBox.x, imageBox.y, { steps: 10 });
  await page.mouse.up();

  const neHandle = await page.$(".ReactCrop__drag-handle.ord-ne");
  const neBox = await neHandle.boundingBox();
  await page.mouse.move(neBox.x + neBox.width / 2, neBox.y + neBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(imageBox.width + imageBox.x, imageBox.height + imageBox.y, { steps: 10 });
  await page.mouse.up();

  console.log("[PGN] Crop set to full image (via drag)");
}

async function convertScorecardToPGN(filePath) {
  const release = await mutex.acquire();
  console.log("[PGN] Launching browser...");
  const browser = await puppeteer.launch({
    headless: true, // use false on launch chrome
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Setup download folder
  const downloadPath = fs.mkdtempSync(path.join(os.tmpdir(), "notamate-download-"));
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
  });

  try {
    await loginToNotamate(page);

    console.log("[PGN] Navigating to convert page...");
    await page.goto(NOTAMATE_URL, { waitUntil: "networkidle2" });

    // Upload file
    const fileInputSelector = "input[data-testid='upload-photo-input']";
    await page.waitForSelector(fileInputSelector, { timeout: 5000 });
    const input = await page.$(fileInputSelector);
    if (!input) throw new Error("Upload input not found!");
    await input.uploadFile(filePath);
    console.log("[PGN] File uploaded:", filePath);

    // Click "No, thanks"
    const noThanksBtn = "button[data-testid='crop-example-no']";
    const elementExists = await page.evaluate(() => {
      return !!document.querySelector("button[data-testid='crop-example-no']");
    });
    if (elementExists) {
      await page.waitForSelector(noThanksBtn, { timeout: 5000 });
      await page.click(noThanksBtn);
      console.log("[PGN] Clicked 'No, thanks'");
    }

    // Set crop
    await setCropToFullImage(page);

    // Proceed steps
    await clickNext(page, "Crop");
    await clickNext(page, "Language");
    await clickNext(page, "Extract");

    // Wait for Download button
    const downloadBtnSelector = "button.btn.btn-secondary i.bi-download";
    await page.waitForSelector(downloadBtnSelector, { timeout: 30000 });

    // Click download
    await page.click(downloadBtnSelector);
    console.log("[PGN] Clicked 'Download as .PGN'");

    // Wait for file to appear in folder
    let downloadedFile;
    for (let i = 0; i < 30; i++) {
      const files = fs.readdirSync(downloadPath);
      if (files.length > 0) {
        downloadedFile = path.join(downloadPath, files[0]);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!downloadedFile) throw new Error("Download failed, no file found");

    // Read PGN
    const pgn = fs.readFileSync(downloadedFile, "utf-8");

    // Cleanup file + folder
    fs.unlinkSync(downloadedFile);
    fs.rmdirSync(downloadPath);

    await browser.close();
    return pgn;
  } catch (err) {
    console.error("[PGN] Error:", err);
    await browser.close();
    throw err;
  } finally {
    console.log(`[Mutex] - Mutex released.`);
    release();
  }
}

async function handleScanScoreSheet(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));

  req.on("end", async () => {
    try {
      const data = JSON.parse(body);
      const validation = validateScanScoreSheet(data);
      if (!validation.valid) {
        res.writeHead(400, errorResponseHeaders);
        return res.end(JSON.stringify(validation));
      }

      // Store the files in a score-sheets folder
      const scoreCardsDir = path.join(__dirname, '..', 'score-cards');
      const scoreCardFileName = `scorecard_${Date.now()}.png`;
      const tempFilePath = path.join(scoreCardsDir, scoreCardFileName);
      if (!fs.existsSync(scoreCardsDir)) {
        fs.mkdirSync(scoreCardsDir, { recursive: true });
      }
      const buffer = Buffer.from(data.scorecardBase64, "base64");
      fs.writeFileSync(tempFilePath, buffer);

      const pgn = await convertScorecardToPGN(tempFilePath);

      const userEmail = data.userEmail;
      const fileMapPath = path.join(scoreCardsDir, 'fileMap.json');
      let fileMap = {};

      if (fs.existsSync(fileMapPath)) {
        fileMap = JSON.parse(fs.readFileSync(fileMapPath, 'utf8'));
      }

      if (!fileMap[userEmail]) {
        fileMap[userEmail] = [];
      }
      fileMap[userEmail].push(scoreCardFileName);

      fs.writeFileSync(fileMapPath, JSON.stringify(fileMap, null, 2));

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ pgn }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Conversion failed" }));
    }
  });
}

module.exports = handleScanScoreSheet;
