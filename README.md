A script that helps see the effects that certain Wikipedia html transformations have on payload sizes for the most popular pages in a given month.

See https://phabricator.wikimedia.org/T293303#8630702 and https://phabricator.wikimedia.org/T326829#8684377 for examples of how it was used.

To run the script:

```bash
npm i
npm run build
node ./payload.js (addSrcSet|addAlternateLinks|addLanguagesToEndOfPage)
```

# Note for Working with older versions of Node.js

You may need to enable the experimental json modules feature.

```
node --experimental-json-modules payload.js
```
