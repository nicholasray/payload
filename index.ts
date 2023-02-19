import { filesize } from "filesize";
import * as fs from "fs";
import fsExtra from "fs-extra";
import { gzipSize } from "gzip-size";
import path from "node:path";
import { Browser, chromium, devices } from "playwright";
import { max, median } from "simple-statistics";
import slugify from "slugify";
import tablemark from "tablemark";
import { fileURLToPath } from "url";
import topViews from "./topviews.json" assert { type: "json" };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTICLE_COUNT = 100;
const SECTIONS_CLICKED: number | "all" = "all";
const BATCH_SIZE = 10;

/**
 * Scrolls to the bottom of the page.
 */
async function scrollToBottom() {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < document.body.scrollHeight; i += 100) {
    window.scrollTo(0, i);
    await delay(20);
  }
}

/**
 * Creates a browser using iPhone 11 context.
 */
async function createContext(browser: Browser, opts = {}) {
  return await browser.newContext({
    ...devices["iPhone 11"],
    deviceScaleFactor: 2,
    ...opts,
  });
}

/**
 * Gets the srcset value of all desktop images so that we can transform the
 * mobile site.
 */
async function getDesktopImages(browser: Browser, slug: string) {
  const context = await createContext(browser);
  const page = await context.newPage();
  await page.goto(`https://en.wikipedia.org/wiki/${slug}?useformat=desktop`, {
    waitUntil: "networkidle",
  });
  const images = await page.evaluate(() => {
    const dict = {};
    const thumbImages = document.querySelectorAll("img[srcset]");
    thumbImages.forEach((thumbImage) => {
      if (thumbImage instanceof HTMLImageElement) {
        dict[thumbImage.src] = thumbImage.srcset;
      }
    });

    return dict;
  });

  await context.close();

  return images;
}

/**
 * Visits a url, clicks a number of sections, scrolls to the bottom of the page,
 * and sums the downloaded html and image transfers.
 */
async function visitPage(
  browser: Browser,
  url: string,
  slug: string,
  type: "before" | "after"
) {
  const context = await createContext(browser, {});
  const page = await context.newPage();
  console.log(`Visiting ${slug} ${type}`);

  // Sum response size of all image requests.
  let imageTransferSize = 0;
  let htmlResponseSize = 0;
  let htmlResponseText = "";

  await page.on("requestfinished", async (request) => {
    if (request.resourceType() === "document") {
      if (htmlResponseSize !== 0) {
        throw new Error(
          "Expected html response size to be zero, but was" + htmlResponseSize
        );
      }
      const sizes = await request.sizes();
      htmlResponseSize += sizes.responseHeadersSize + sizes.responseBodySize;
      htmlResponseText = await (await request.response()).text();
    }

    if (request.resourceType() === "image") {
      const sizes = await request.sizes();
      imageTransferSize += sizes.responseHeadersSize + sizes.responseBodySize;
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });

  // Click first section
  let sections = await page
    .locator(".mw-parser-output > .collapsible-heading")
    .all();

  if (sections.length) {
    for (
      let i = 0;
      i < (SECTIONS_CLICKED === "all" ? sections.length : SECTIONS_CLICKED);
      i++
    ) {
      await sections[i].click();
    }
  }
  await page.evaluate(scrollToBottom);
  // Wait for images to load.
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(__dirname, `/pages/${type}/${slug}.jpg`),
  });

  // Teardown
  await context.close();

  return {
    imageTransferSize,
    htmlSize: Buffer.byteLength(htmlResponseText, "utf8"),
    htmlTransferSize: await gzipSize(htmlResponseText),
  };
}

/**
 * Create two versions of the same page — one version will contain lazy loaded
 * images without the srcset attribute, the other version will contain lazy
 * loaded images with the srcset attribute.
 */
async function createVersions(browser: Browser, slug: string) {
  const desktopImages = await getDesktopImages(browser, slug);
  const context = await createContext(browser, {
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(`https://en.m.wikipedia.org/wiki/${slug}`, {
    waitUntil: "load",
  });
  await page.evaluate(() => {
    const base = document.createElement("base");
    base.href = "https://en.m.wikipedia.org";
    document.head.prepend(base);
  });
  const beforeHtml = await page.content();
  const beforePath = path.join(__dirname, `/pages/before/${slug}.html`);
  await fs.promises.writeFile(beforePath, beforeHtml);

  // Transform HTML.
  await page.evaluate((desktopImages) => {
    // Only transform if passed a non-empty desktopImages object.
    const placeholders = document.querySelectorAll(".lazy-image-placeholder");
    placeholders.forEach((placeholder) => {
      if (!(placeholder instanceof HTMLElement)) {
        return;
      }

      const srcSet = desktopImages[`https:${placeholder.dataset.src}`];
      if (srcSet) {
        placeholder.dataset.srcset = srcSet;
      }
    });
  }, desktopImages);

  const afterHtml = await page.content();
  const afterPath = path.join(__dirname, `/pages/after/${slug}.html`);
  await fs.promises.writeFile(afterPath, afterHtml);
  await context.close();

  return {
    before: {
      path: beforePath,
    },
    after: {
      path: afterPath,
    },
  };
}

(async () => {
  // Setup
  const browser = await chromium.launch();
  fsExtra.emptyDirSync(path.join(__dirname, "/pages/before"));
  fsExtra.emptyDirSync(path.join(__dirname, "/pages/after"));

  const stats = [];
  let queue = topViews.slice(0, ARTICLE_COUNT);

  console.log(`Visiting ${queue.length} pages...`);

  while (queue.length) {
    const views = queue.splice(0, BATCH_SIZE);

    const promises = views.map(async (view) => {
      // @ts-ignore
      const slug = slugify(view.article, "_");

      // Create two versions of the same page.
      const paths = await createVersions(browser, slug);

      const beforeStats = await visitPage(
        browser,
        `file:///${paths.before.path}`,
        slug,
        "before"
      );
      const afterStats = await visitPage(
        browser,
        `file:///${paths.after.path}`,
        slug,
        "after"
      );

      stats.push({
        page: slug,
        beforeHtmlSize: beforeStats.htmlSize,
        afterHtmlSize: afterStats.htmlSize,
        diffHtmlSize: afterStats.htmlSize - beforeStats.htmlSize,
        beforeHtmlTransferSize: beforeStats.htmlTransferSize,
        afterHtmlTransferSize: afterStats.htmlTransferSize,
        diffHtmlTransferSize:
          afterStats.htmlTransferSize - beforeStats.htmlTransferSize,
        beforeImageTransferSize: beforeStats.imageTransferSize,
        afterImageTransferSize: afterStats.imageTransferSize,
        diffImageTransferSize:
          afterStats.imageTransferSize - beforeStats.imageTransferSize,
      });
    });

    await Promise.all(promises);
  }

  // Sort by image size
  stats.sort((a, b) => {
    if (a.diffImageTransferSize < b.diffImageTransferSize) {
      // a is less than b.
      return -1;
    }

    if (a.diffImageTransferSize > b.diffImageTransferSize) {
      // b is less than a.
      return 1;
    }

    // a === b.
    return 0;
  });

  const statsFormatted = tablemark(
    stats.map((stat) => {
      return Object.keys(stat).reduce((accum, key) => {
        if (key === "page") {
          accum[key] = stat[key];

          return accum;
        }

        accum[key] = filesize(stat[key]);

        return accum;
      }, {});
    })
  );

  const diffHtmlSize = stats.map((stat) => stat.diffHtmlSize);
  const diffHtmlTransferSize = stats.map((stat) => stat.diffHtmlTransferSize);
  const diffImageTransferSize = stats.map((stat) => stat.diffImageTransferSize);

  const aggregate = tablemark([
    {
      medianDiffHtmlSize: filesize(median(diffHtmlSize)),
      maxDiffHtmlSize: filesize(max(diffHtmlSize)),
      medianDiffHtmlTransferSize: filesize(median(diffHtmlTransferSize)),
      maxDiffHtmlTransferDiff: filesize(max(diffHtmlTransferSize)),
      medianDiffImageTransferSize: filesize(median(diffImageTransferSize)),
      maxDiffImageTransferSize: filesize(max(diffImageTransferSize)),
    },
  ]);

  await fs.promises.writeFile(
    path.join(__dirname, "output.md"),
    statsFormatted + "\n\n" + aggregate
  );

  console.log(statsFormatted);
  console.log(aggregate);

  // Teardown
  await browser.close();
})();
