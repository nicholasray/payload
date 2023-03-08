/**
 * Gets the language links from the desktop version
 */
export async function getLanguageLinks(context, slug) {
    const page = await context.newPage();
    console.log('testing', `https://en.wikipedia.org/wiki/${slug}?useformat=desktop`)
    await page.goto(`https://en.wikipedia.org/wiki/${slug}?useformat=desktop`, {
      waitUntil: "networkidle",
    });
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a")).map((link) => {
            return {
                code: link.getAttribute('hreflang'),
                href: link.getAttribute('href')
            };
        }).filter((lang) => lang.code);
    });
    await context.close();
    return links;
}
