/** Селектори за Instagram. При промяна на сайта поправете само този файл. */
export const instagram = {
  site: "Instagram",
  tagUrl: (tag: string) => `https://www.instagram.com/explore/tags/${encodeURIComponent(tag.replace(/^#/, ""))}/`,
  guards: {
    loginUrl: /\/accounts\/login|\/challenge\//,
    loginSelectors: ['input[name="username"]', 'form#loginForm'],
    captchaUrl: /\/challenge\/|captcha/i,
    captchaSelectors: ['iframe[src*="captcha"]'],
  },
  /** Връзки към публикации на страницата на хаштага */
  postLink: 'a[href*="/p/"], a[href*="/reel/"]',
  /** На страницата на публикацията */
  caption: 'h1, div[role="dialog"] h1, article h1',
  author: 'header a[href^="/"][role="link"], article header a',
  time: "time[datetime]",
  /** Резервно: описанието в meta таговете съдържа текста и автора */
  metaDescription: 'meta[property="og:description"], meta[name="description"]',
  metaTitle: 'meta[property="og:title"]',
} as const;
