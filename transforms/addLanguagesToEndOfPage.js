import { getLanguageLinks } from './utils.js';

const transform = ([ langLinks ]) => {
    const head = document.querySelector("head");
    const div = document.createElement('div');
    div.setAttribute( 'id', 'p-lang' );
    const h4 = document.createElement('h4');
    h4.textContent = 'Read in another language';
    const ul = document.createElement('ul');
    ul.setAttribute('class', 'minerva-footer-languages');
    langLinks.forEach((lang) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.setAttribute('hreflang', lang.code);
      link.setAttribute('href', lang.href);
      link.textContent = lang.text;
      li.appendChild(link);
      ul.appendChild(li);
    });
    div.appendChild( h4 );
    div.appendChild( ul );
    const style = document.createElement('style');
    style.textContent = `#p-lang {
    display: none;
}
#p-lang:target {
  display: block;
}
  
.minerva-footer-languages {
  column-count: 3;
}`;
    head.appendChild( style );
    document.querySelector( 'footer .post-content.footer-content' ).prepend(div);
};

const getArgs = async (context, slug) => {
  const langLinks = await getLanguageLinks(context, slug);
  return Promise.resolve([ langLinks ]);
};

export default {
    name: 'LangLinksEndPage',
    getArgs,
    transform
};
