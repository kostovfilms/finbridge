/**
 * Селектори за Facebook. Facebook сменя HTML често: ако спре да намира
 * публикации, поправете само този файл (виж README, „Поправка на селектори“).
 */
export const facebook = {
  site: "Facebook",
  groupUrl: (url: string) => {
    const u = new URL(url);
    u.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    return u.toString();
  },
  searchUrl: (q: string) => `https://www.facebook.com/search/posts/?q=${encodeURIComponent(q)}&filters=${encodeURIComponent(
    // „Най-нови публикации“
    Buffer.from('{"recent_posts:0":"{\\"name\\":\\"recent_posts\\",\\"args\\":\\"\\"}"}').toString("base64"),
  )}`,
  guards: {
    loginUrl: /\/login(\/|\.php|\?|$)|\/recover\//,
    loginSelectors: ['form#login_form', 'input[name="email"][type="text"], input[name="email"][type="email"]'],
    captchaUrl: /\/checkpoint\/|captcha/i,
    captchaSelectors: ['iframe[src*="captcha"]', 'iframe[title*="reCAPTCHA"]'],
  },
  /** Една публикация в лентата на група или в резултатите от търсене */
  post: 'div[role="feed"] div[aria-posinset], div[role="feed"] > div div[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Коментар"])',
  /** Текстът на публикацията */
  text: '[data-ad-preview="message"], [data-ad-comet-preview="message"], div[dir="auto"][style*="text-align"]',
  /** Резервен вариант за текст */
  textFallback: 'div[dir="auto"]',
  /** Име на автора */
  author: 'h2 a[role="link"] strong, h3 a[role="link"] strong, h2 strong, h3 strong, [data-ad-rendering-role="profile_name"] a',
  /** Връзка към самата публикация (в нея е и датата) */
  permalink: 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="/groups/"][href*="/posts/"]',
  /** Елемент с дата (Facebook я крие; ползва се aria-label/текст на връзката) */
  time: "abbr[data-utime], time[datetime]",
  /** Бутон за разгъване на дълъг текст. Само тези текстове се натискат. */
  seeMoreTexts: ["See more", "Виж още", "Вижте още", "Още"],
} as const;
