import { getLanguageLinks } from './utils.js';

const transform = ([ langLinks ]) => {
    const head = document.querySelector("head");
    langLinks.forEach((lang) => {
      const link = document.createElement('link');
      link.setAttribute('hreflang', lang.code);
      link.setAttribute('rel', 'alternate');
      link.setAttribute('href', lang.href);
      head.appendChild(link);
    });
};

const getArgs = async (context, slug) => {
  const langLinks = await getLanguageLinks(context, slug);
  return Promise.resolve([ langLinks ]);
};

export default {
    name: 'AlternateLinks',
    getArgs,
    transform
};
