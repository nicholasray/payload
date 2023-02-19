A script I made to help see the image and html payload effects of adding the `srcset` attribute to lazy loaded images on Wikipedia's mobile site.

The script compares the image and html payload sizes for two different user scenrios. See https://phabricator.wikimedia.org/T293303#8630702 for the results and analysis.

To run the script:

```bash
npm i
npm run build
node ./index.js
```
