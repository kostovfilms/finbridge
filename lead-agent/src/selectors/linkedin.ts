/** Селектори за LinkedIn. При промяна на сайта поправете само този файл. */
export const linkedin = {
  site: "LinkedIn",
  searchUrl: (q: string) =>
    `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&sortBy=%22date_posted%22`,
  guards: {
    loginUrl: /\/login|\/authwall|\/uas\/login|\/signup/,
    loginSelectors: ['form.login__form', 'input#username'],
    captchaUrl: /\/checkpoint\/challenge|captcha/i,
    captchaSelectors: ['iframe[src*="captcha"]', "#captcha-internal"],
  },
  post: "div.feed-shared-update-v2, div[data-urn^='urn:li:activity:'], li.reusable-search__result-container div[data-urn]",
  urnAttr: "data-urn",
  text: ".update-components-text, .feed-shared-inline-show-more-text, .feed-shared-text",
  author: ".update-components-actor__title span[aria-hidden='true'], .update-components-actor__name span[aria-hidden='true'], .feed-shared-actor__name",
  time: ".update-components-actor__sub-description span[aria-hidden='true'], .feed-shared-actor__sub-description",
  permalink: "a[href*='/feed/update/'], a[href*='/posts/']",
  postUrl: (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`,
  seeMoreTexts: ["…see more", "...see more", "see more", "…още", "още"],
} as const;
