// Add source map support to make debugging errors easier.
import sourceMapSupport from "source-map-support";
sourceMapSupport.install();
import { filesize } from "filesize";
import * as fs from "fs";
import fsExtra from "fs-extra";
import { gzipSize } from "gzip-size";
import path from "node:path";
import { Browser, BrowserContext, chromium, devices } from "playwright";
import { max, median } from "simple-statistics";
import transforms from "./transforms/index.js";
import slugify from "slugify";
// eslint-disable-next-line node/no-missing-import
import tablemark from "tablemark";
import { fileURLToPath } from "url";
import topViews from "./topviews-2023_02.json" assert { type: "json" };
import { capFirstLetter } from "./transforms/utils.js";
// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = "output";
const PAGES_DIR = `${OUTPUT_DIR}/pages`;
const ARTICLE_COUNT = 100;
const SECTIONS_CLICKED: number | "all" = 0;
const BATCH_SIZE = 10;
import pLimit from "p-limit";
const limit = pLimit(BATCH_SIZE);

interface Transformer {
  name: string;
  getArgs: (context: BrowserContext, slug: string) => [];
  transform: () => void;
}

/**
 * Scrolls to the bottom of the page.
 */
async function scrollToBottom() {
  const delay = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  for (let i = 0; i < document.body.scrollHeight; i += 100) {
    window.scrollTo(0, i);
    await delay(20);
  }
}

/**
 * Creates a browser using iPhone 11 context.
 *
 * @param browser
 * @param opts
 */
async function createContext(browser: Browser, opts = {}) {
  return await browser.newContext({
    ...devices["iPhone 11"],
    deviceScaleFactor: 2,
    ...opts,
  });
}

/**
 * Visits a url, clicks a number of sections, scrolls to the bottom of the page,
 * and sums the downloaded html and image transfers.
 *
 * @param browser
 * @param url
 * @param slug
 * @param saveFolder
 */
async function visitPage(
  browser: Browser,
  url: string,
  slug: string,
  saveFolder: string
) {
  const context = await createContext(browser);
  const page = await context.newPage();
  console.log(`Visiting ${slug} and saving image to ${saveFolder}`);

  // Sum response size of all image requests.
  let htmlResponseText = "";
  let imageTransferSize = 0;
  page.on("requestfinished", async (request) => {
    if (
      request.resourceType() === "document" &&
      request.url().endsWith(`${slug}.html`)
    ) {
      if (htmlResponseText !== "") {
        throw new Error(
          "Expected html response text to be empty, but was" + htmlResponseText
        );
      }
      htmlResponseText = await (await request.response()).text();
    }

    if (request.resourceType() === "image") {
      const sizes = await request.sizes();
      imageTransferSize += sizes.responseHeadersSize + sizes.responseBodySize;
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });

  // Find first paragraph so we can calculate the transfer size from the
  // beginning of the doc to the end of the first paragraph.
  const firstParagraph = await page
    .locator("p:not(.mw-empty-elt)")
    .first()
    .evaluate((elem) => elem.outerHTML);

  const splitFirstParagraph = htmlResponseText.split(firstParagraph);
  if (splitFirstParagraph.length !== 2) {
    throw new Error(
      `Splitting html by first paragraph for article "${slug}" was expected to result in array length of 2. Instead got ` +
        splitFirstParagraph.length
    );
  }

  const endOfFirstParagraphHtml =
    htmlResponseText.split(firstParagraph).shift() + firstParagraph;

  await fs.promises.writeFile(
    path.join(__dirname, PAGES_DIR, `${saveFolder}/p-${slug}.html`),
    endOfFirstParagraphHtml
  );

  // Click first section
  const sections = await page
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
    path: path.join(__dirname, PAGES_DIR, `${saveFolder}/${slug}.jpg`),
  });

  // Teardown
  await context.close();

  return {
    imageTransferSize,
    htmlSizeParagraph: Buffer.byteLength(endOfFirstParagraphHtml, "utf8"),
    htmlTransferSizeParagraph: await gzipSize(endOfFirstParagraphHtml),
    htmlSize: Buffer.byteLength(htmlResponseText, "utf8"),
    htmlTransferSize: await gzipSize(htmlResponseText),
  };
}

const makePage = async (
  context: BrowserContext,
  host: string,
  path: string
) => {
  const page = await context.newPage();
  await page.goto(`${host}/${path}`, {
    waitUntil: "load",
  });

  await page.evaluate((host) => {
    const base = document.createElement("base");
    base.href = host;
    document.head.prepend(base);
  }, host);
  return page;
};

/**
 * Create two versions of the same page — "before" and "after". The "before"
 * version is almost identical to the production page. The "after" version takes
 * the "before" version and applies transformations to it.
 *
 * @param browser
 * @param slug
 * @param transformer
 * @param host
 */
async function createVersions(
  browser: Browser,
  slug: string,
  transformer: Transformer,
  host: string
) {
  const context = await createContext(browser, {
    javaScriptEnabled: false,
  });
  const page = await makePage(context, host, `wiki/${slug}`);
  const beforeHtml = await page.content();
  const beforePath = path.join(
    __dirname,
    PAGES_DIR,
    `${transformer.name}/before/${slug}.html`
  );
  await fs.promises.writeFile(beforePath, beforeHtml);

  // Transform HTML.
  const transformContext = await createContext(browser);
  const args = await transformer.getArgs(transformContext, slug);
  await page.evaluate(transformer.transform, args);

  const afterHtml = await page.content();
  const afterPath = path.join(
    __dirname,
    PAGES_DIR,
    `${transformer.name}/after/${slug}.html`
  );
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

function emptyDirectories(transformerName: string) {
  fsExtra.emptyDirSync(
    path.join(__dirname, PAGES_DIR, `${transformerName}/before`)
  );
  fsExtra.emptyDirSync(
    path.join(__dirname, PAGES_DIR, `${transformerName}/after`)
  );
}

(async () => {
  // Setup
  const clArguments = process.argv;
  const transform = clArguments[2] || "addSrcSet";
  const browser = await chromium.launch();
  const transformer = transforms[transform];
  if (!transformer) {
    throw new Error(
      `Unknown transform name. Available transforms are ${Object.keys(
        transforms
      ).join(",")}`
    );
  }
  const transformerName = transformer.name;
  emptyDirectories(transformerName);

  const stats = [];
  const queue = topViews.slice(0, ARTICLE_COUNT);

  console.log(
    `Visiting ${queue.length} pages with transform ${transformerName}...`
  );

  const promises = queue.map(async (view) => {
    return limit(async () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const slug = slugify(view.article, "_");

      // Create two versions of the same page.
      const paths = await createVersions(
        browser,
        slug,
        transformer,
        "https://en.m.wikipedia.org"
      );

      const [beforeStats, afterStats] = await Promise.all([
        visitPage(
          browser,
          `file:///${paths.before.path}`,
          slug,
          `${transformer.name}/before`
        ),
        visitPage(
          browser,
          `file:///${paths.after.path}`,
          slug,
          `${transformer.name}/after`
        ),
      ]);

      stats.push(
        Object.keys(beforeStats).reduce(
          (obj, current) => {
            const capKey = capFirstLetter(current);

            obj[`before${capKey}`] = beforeStats[current];
            obj[`after${capKey}`] = afterStats[current];
            obj[`diff${capKey}`] = afterStats[current] - beforeStats[current];

            return obj;
          },
          { page: slug }
        )
      );
    });
  });

  await Promise.all(promises);

  // Sort by html transfer size.
  stats.sort((a, b) => {
    if (a.diffHtmlTransferSize < b.diffHtmlTransferSize) {
      // a is less than b.
      return -1;
    }

    if (a.diffHtmlTransferSize > b.diffHtmlTransferSize) {
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

  const differences = Object.keys(stats[0]).reduce((obj, current) => {
    if (!current.startsWith("diff")) {
      return obj;
    }

    obj[current] = stats.map((stat) => stat[current]);

    return obj;
  }, {});

  const aggregate = tablemark([
    Object.keys(differences).reduce((obj, current) => {
      obj[`median${capFirstLetter(current)}`] = filesize(
        median(differences[current])
      );
      obj[`max${capFirstLetter(current)}`] = filesize(
        max(differences[current])
      );

      return obj;
    }, {}),
  ]);

  await fs.promises.writeFile(
    path.join(__dirname, OUTPUT_DIR, `${transformerName}.md`),
    statsFormatted + "\n\n" + aggregate
  );

  console.log(aggregate);
  console.log(statsFormatted);

  // Teardown
  await browser.close();
})();
