A script help see the effects that mobile wikipedia html transformations have on payload sizes.

See https://phabricator.wikimedia.org/T293303#8630702 and https://phabricator.wikimedia.org/T326829#8684377 for examples of how it was used.

To run the script:

```bash
npm i
npm run build
node ./index.js (addSrcSet|addAlternateLinks|addLanguagesToEndOfPage)
```

# Note for Working with older versions of Node.js

You may need to enable the experimental json modules feature.

```
node --experimental-json-modules index.js
```
