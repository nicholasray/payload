/**
 * Gets the srcset value of all desktop images so that we can transform the
 * mobile site.
 */
async function getDesktopImages(context, slug) {
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

const transform = ([desktopImages]) => {
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
};

const getArgs = async (context, slug) => {
  const desktopImages = await getDesktopImages(context, slug);
  return Promise.resolve( [ desktopImages ] );
};

export default {
    name: 'AddSrcSet',
    getArgs,
    transform
};
